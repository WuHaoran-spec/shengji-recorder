package io.shengji.recorder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import java.io.File;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class RecordingService extends Service {
    public static final String START = "io.shengji.recorder.START";
    public static final String STOP = "io.shengji.recorder.STOP";
    private static final String CHANNEL = "shengji-recording";
    private static final int NOTIFICATION_ID = 41;
    public interface Listener {
        void onStarted();
        void onStopped(JSObject result);
        void onError(String message);
    }
    public static volatile Listener listener;
    public static volatile boolean recording;
    public static volatile boolean processing;
    public static volatile JSObject lastResult;
    public static volatile String activePath;
    public static volatile String captureMode = "audio";
    private static volatile long startedAt;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private MediaRecorder recorder;
    private MediaProjection projection;
    private VirtualDisplay display;
    private File output;
    private boolean screen;
    private boolean finishing;
    private boolean recorderStarted;
    private boolean fileLimitReached;
    private final Runnable durationLimit = this::finishRecording;
    private final MediaProjection.Callback projectionCallback = new MediaProjection.Callback() {
        @Override public void onStop() { finishRecording(); }
    };

    public static double elapsedSeconds() {
        return recording ? (SystemClock.elapsedRealtime() - startedAt) / 1000.0 : 0;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if (STOP.equals(intent.getAction())) {
            finishRecording();
            return START_NOT_STICKY;
        }
        if (!START.equals(intent.getAction()) || recording || processing) return START_NOT_STICKY;
        try {
            screen = "screen".equals(intent.getStringExtra("mode"));
            captureMode = screen ? "screen" : "audio";
            startRecordingForeground();
            prepareRecorder(intent);
        } catch (Exception error) {
            fail("无法开始录制：" + error.getMessage());
        }
        return START_NOT_STICKY;
    }

    private void startRecordingForeground() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "正在录制", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("显示本机录音或录屏的持续状态，并提供停止按钮");
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openAction = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, RecordingService.class).setAction(STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(screen ? "声记正在录屏和录音" : "声记正在录音")
            .setContentText("音视频仅保存在本机。点击停止后生成本机音频文件。")
            .setContentIntent(openAction)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_media_pause, "停止录制", stopAction)
            .build();
        if (Build.VERSION.SDK_INT >= 29) {
            int types = screen ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION : 0;
            if (Build.VERSION.SDK_INT >= 30) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            startForeground(NOTIFICATION_ID, notification, types);
        } else startForeground(NOTIFICATION_ID, notification);
    }

    @SuppressWarnings("deprecation")
    private void prepareRecorder(Intent intent) throws Exception {
        finishing = false;
        fileLimitReached = false;
        lastResult = null;
        File directory = new File(getFilesDir(), "recordings");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("无法创建本机录制目录");
        output = new File(directory, UUID.randomUUID() + (screen ? ".mp4" : ".m4a"));
        activePath = output.getAbsolutePath();
        recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
        recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        if (screen) recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        recorder.setAudioSamplingRate(44100);
        recorder.setAudioChannels(1);
        recorder.setAudioEncodingBitRate(128000);
        recorder.setOutputFile(output.getAbsolutePath());
        recorder.setMaxFileSize(200L * 1024 * 1024);
        int width = 0, height = 0, density = getResources().getDisplayMetrics().densityDpi;
        if (screen) {
            WindowManager window = (WindowManager) getSystemService(WINDOW_SERVICE);
            if (Build.VERSION.SDK_INT >= 30) {
                Rect bounds = window.getMaximumWindowMetrics().getBounds();
                width = bounds.width(); height = bounds.height();
            } else {
                DisplayMetrics metrics = new DisplayMetrics();
                window.getDefaultDisplay().getRealMetrics(metrics);
                width = metrics.widthPixels; height = metrics.heightPixels;
            }
            double scale = Math.min(1.0, 1920.0 / Math.max(width, height));
            width = Math.max(2, ((int) (width * scale) / 2) * 2);
            height = Math.max(2, ((int) (height * scale) / 2) * 2);
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
            recorder.setVideoSize(width, height);
            recorder.setVideoFrameRate(30);
            recorder.setVideoEncodingBitRate(1500000);
        }
        recorder.setOnErrorListener((value, what, extra) -> main.post(this::finishRecording));
        recorder.setOnInfoListener((value, what, extra) -> {
            if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
                fileLimitReached = true;
                main.post(this::finishRecording);
            }
        });
        recorder.prepare();
        if (screen) {
            Intent data = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableExtra("projectionData", Intent.class)
                : intent.getParcelableExtra("projectionData");
            if (data == null) throw new IllegalStateException("缺少本次屏幕录制授权");
            MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            projection = manager.getMediaProjection(intent.getIntExtra("resultCode", 0), data);
            if (projection == null) throw new IllegalStateException("屏幕录制授权已失效");
            // Android 14+ requires registration before createVirtualDisplay.
            projection.registerCallback(projectionCallback, main);
            display = projection.createVirtualDisplay("声记录屏", width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, recorder.getSurface(), null, main);
        }
        recorder.start();
        recorderStarted = true;
        startedAt = SystemClock.elapsedRealtime();
        recording = true;
        // Native timer also runs while the WebView is suspended in the background.
        main.postDelayed(durationLimit, 30 * 60 * 1000L);
        if (listener != null) listener.onStarted();
    }

    private void finishRecording() {
        if (finishing || recorder == null) return;
        finishing = true;
        main.removeCallbacks(durationLimit);
        double duration = elapsedSeconds();
        recording = false;
        processing = true;
        try {
            if (!recorderStarted) throw new IllegalStateException("录制尚未开始");
            recorder.stop();
            recorderStarted = false;
        } catch (Exception error) {
            // MediaRecorder may already have stopped asynchronously at its file
            // limit. Preserve that completed file and let extraction validate it.
            if (!fileLimitReached || output == null || output.length() == 0) {
                fail("录制太短或被系统中断，无法生成有效文件。请至少录制一秒后停止。");
                return;
            }
        }
        releaseCapture();
        final File source = output;
        final boolean isScreen = screen;
        worker.execute(() -> {
            JSObject result = new JSObject();
            result.put("path", source.getAbsolutePath());
            result.put("mode", isScreen ? "screen" : "audio");
            result.put("duration", duration);
            result.put("mimeType", isScreen ? "video/mp4" : "audio/mp4");
            File audio = source;
            try {
                if (isScreen) {
                    File extracted = new File(source.getParentFile(), source.getName().replace(".mp4", "-audio.m4a"));
                    AudioFiles.extractAudio(source, extracted);
                    audio = extracted;
                }
                result.put("compressedAudioPath", audio.getAbsolutePath());
                File wav = new File(source.getParentFile(), source.getName() + ".wav");
                AudioFiles.decodeToWav(audio, wav);
                result.put("audioPath", wav.getAbsolutePath());
            } catch (Exception error) {
                result.put("audioPath", audio.getAbsolutePath());
                result.put("warning", "原始录制已保存，音频转换失败：" + error.getMessage());
            }
            try {
                // Commit metadata before notifying JavaScript, so an Activity recreation
                // or process restart cannot lose a completed, unacknowledged recording.
                RecordingFiles.save(this, result);
            } catch (Exception error) {
                result.put("warning", "原始录制已保存，但恢复信息写入失败，请立即导出或保存到资料库：" + error.getMessage());
            }
            main.post(() -> {
                lastResult = result;
                processing = false;
                activePath = null;
                if (listener != null) listener.onStopped(result);
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            });
        });
    }

    private void releaseCapture() {
        if (display != null) {
            try { display.release(); } catch (RuntimeException ignored) { }
            display = null;
        }
        if (projection != null) {
            try { projection.unregisterCallback(projectionCallback); } catch (RuntimeException ignored) { }
            try { projection.stop(); } catch (RuntimeException ignored) { }
            projection = null;
        }
        if (recorder != null) {
            try { recorder.release(); } catch (RuntimeException ignored) { }
            recorder = null;
        }
        recorderStarted = false;
    }

    private void fail(String message) {
        recording = false;
        processing = false;
        finishing = true;
        main.removeCallbacks(durationLimit);
        activePath = null;
        releaseCapture();
        if (listener != null) listener.onError(message);
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override public void onDestroy() {
        // Graceful service destruction can still finalize the current file. A hard
        // process kill provides no callback and cannot promise MP4 recovery.
        if (recorderStarted && !finishing) finishRecording();
        main.removeCallbacks(durationLimit);
        releaseCapture();
        recording = false;
        worker.shutdown();
        super.onDestroy();
    }
}
