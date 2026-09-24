package io.shengji.recorder;

import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/** Streaming local audio conversion: no server, speech service, or full-file PCM allocation. */
final class AudioFiles {
    private AudioFiles() { }

    static void extractAudio(File input, File output) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        boolean started = false;
        try {
            extractor.setDataSource(input.getAbsolutePath());
            int track = audioTrack(extractor);
            MediaFormat format = extractor.getTrackFormat(track);
            extractor.selectTrack(track);
            muxer = new MediaMuxer(output.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int destination = muxer.addTrack(format);
            muxer.start(); started = true;
            int capacity = format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)
                ? Math.max(1024 * 1024, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)) : 1024 * 1024;
            ByteBuffer buffer = ByteBuffer.allocateDirect(capacity);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (true) {
                buffer.clear();
                int length = extractor.readSampleData(buffer, 0);
                if (length < 0) break;
                info.set(0, length, extractor.getSampleTime(), extractor.getSampleFlags());
                buffer.position(0); buffer.limit(length);
                muxer.writeSampleData(destination, buffer, info);
                extractor.advance();
            }
        } finally {
            extractor.release();
            if (muxer != null) {
                try { if (started) muxer.stop(); } finally { muxer.release(); }
            }
        }
    }

    static void decodeToWav(File input, File output) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        boolean started = false;
        try (WavWriter writer = new WavWriter(output)) {
            extractor.setDataSource(input.getAbsolutePath());
            int track = audioTrack(extractor);
            extractor.selectTrack(track);
            MediaFormat format = extractor.getTrackFormat(track);
            String mime = format.getString(MediaFormat.KEY_MIME);
            if (mime == null) throw new IOException("音频缺少编码格式");
            format.setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(format, null, null, 0);
            codec.start(); started = true;
            int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            int encoding = AudioFormat.ENCODING_PCM_16BIT;
            Resampler resampler = new Resampler(rate, writer);
            boolean inputEnded = false;
            boolean outputEnded = false;
            long lastProgress = System.nanoTime();
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (!outputEnded) {
                if (!inputEnded) {
                    int index = codec.dequeueInputBuffer(10000);
                    if (index >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(index);
                        if (buffer == null) throw new IOException("音频解码输入不可用");
                        buffer.clear();
                        int length = extractor.readSampleData(buffer, 0);
                        if (length < 0) {
                            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputEnded = true;
                        } else {
                            codec.queueInputBuffer(index, 0, length, Math.max(0, extractor.getSampleTime()), 0);
                            extractor.advance();
                        }
                        lastProgress = System.nanoTime();
                    }
                }
                int index = codec.dequeueOutputBuffer(info, 10000);
                if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat actual = codec.getOutputFormat();
                    int actualRate = actual.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    channels = actual.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    encoding = actual.containsKey(MediaFormat.KEY_PCM_ENCODING)
                        ? actual.getInteger(MediaFormat.KEY_PCM_ENCODING) : AudioFormat.ENCODING_PCM_16BIT;
                    if (actualRate != rate) { rate = actualRate; resampler = new Resampler(rate, writer); }
                    lastProgress = System.nanoTime();
                } else if (index >= 0) {
                    ByteBuffer buffer = codec.getOutputBuffer(index);
                    if (buffer != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        buffer.position(info.offset); buffer.limit(info.offset + info.size);
                        buffer = buffer.slice().order(ByteOrder.LITTLE_ENDIAN);
                        int bytesPerSample;
                        if (encoding == AudioFormat.ENCODING_PCM_16BIT) bytesPerSample = 2;
                        else if (encoding == AudioFormat.ENCODING_PCM_FLOAT) bytesPerSample = 4;
                        else if (encoding == AudioFormat.ENCODING_PCM_8BIT) bytesPerSample = 1;
                        else throw new IOException("设备返回了不支持的 PCM 格式：" + encoding);
                        if (channels <= 0) throw new IOException("无效的音频声道数");
                        int frameSize = bytesPerSample * channels;
                        while (buffer.remaining() >= frameSize) {
                            double mono = 0;
                            for (int channel = 0; channel < channels; channel++) {
                                if (encoding == AudioFormat.ENCODING_PCM_FLOAT) mono += buffer.getFloat();
                                else if (encoding == AudioFormat.ENCODING_PCM_8BIT) mono += ((buffer.get() & 255) - 128) / 128.0;
                                else mono += buffer.getShort() / 32768.0;
                            }
                            resampler.accept(mono / channels);
                        }
                    }
                    outputEnded = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    codec.releaseOutputBuffer(index, false);
                    lastProgress = System.nanoTime();
                }
                if (System.nanoTime() - lastProgress > 15000000000L) throw new IOException("本机音频解码超时");
            }
            resampler.finish();
        } finally {
            extractor.release();
            if (codec != null) {
                try { if (started) codec.stop(); } finally { codec.release(); }
            }
        }
    }

    private static int audioTrack(MediaExtractor extractor) throws IOException {
        for (int index = 0; index < extractor.getTrackCount(); index++) {
            String mime = extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME);
            if (mime != null && mime.startsWith("audio/")) return index;
        }
        throw new IOException("录制文件没有音频轨道");
    }

    /** Fractional box integration keeps memory constant and avoids dropping arbitrary frames. */
    private static final class Resampler {
        final double ratio;
        final WavWriter writer;
        double used;
        double sum;
        Resampler(int inputRate, WavWriter writer) throws IOException {
            if (inputRate <= 0) throw new IOException("无效采样率");
            this.ratio = inputRate / 16000.0;
            this.writer = writer;
        }
        void accept(double value) throws IOException {
            double remaining = 1;
            while (remaining > 0.0000001) {
                double weight = Math.min(remaining, ratio - used);
                sum += value * weight;
                used += weight;
                remaining -= weight;
                if (used + 0.0000001 >= ratio) {
                    writer.sample(sum / used);
                    sum = 0; used = 0;
                }
            }
        }
        void finish() throws IOException {
            if (used > 0.0000001) writer.sample(sum / used);
        }
    }

    private static final class WavWriter implements AutoCloseable {
        final File file;
        final BufferedOutputStream stream;
        long bytes;
        WavWriter(File file) throws IOException {
            this.file = file;
            stream = new BufferedOutputStream(new FileOutputStream(file), 65536);
            stream.write(new byte[44]);
        }
        void sample(double sample) throws IOException {
            if (bytes > 0xFFFFFFFFL - 38) throw new IOException("录音超出 WAV 文件大小限制");
            int value = (int) Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
            stream.write(value & 255); stream.write((value >>> 8) & 255);
            bytes += 2;
        }
        @Override public void close() throws IOException {
            stream.close();
            ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
            header.put("RIFF".getBytes(StandardCharsets.US_ASCII));
            header.putInt((int) bytes + 36);
            header.put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
            header.putInt(16).putShort((short) 1).putShort((short) 1);
            header.putInt(16000).putInt(32000).putShort((short) 2).putShort((short) 16);
            header.put("data".getBytes(StandardCharsets.US_ASCII)).putInt((int) bytes);
            try (RandomAccessFile result = new RandomAccessFile(file, "rw")) {
                result.seek(0); result.write(header.array());
            }
        }
    }
}
