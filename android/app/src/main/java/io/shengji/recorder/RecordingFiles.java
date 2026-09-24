package io.shengji.recorder;

import android.content.Context;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;

/** Durable handoff to IndexedDB. Originals remain until the UI acknowledges storage. */
final class RecordingFiles {
    private RecordingFiles() { }

    static synchronized void save(Context context, JSObject result) throws IOException {
        File source = sourceFile(context, result.getString("path"));
        AtomicFile metadata = new AtomicFile(new File(source.getAbsolutePath() + ".json"));
        FileOutputStream stream = null;
        try {
            stream = metadata.startWrite();
            stream.write(result.toString().getBytes(StandardCharsets.UTF_8));
            metadata.finishWrite(stream);
        } catch (IOException error) {
            if (stream != null) metadata.failWrite(stream);
            throw error;
        }
    }

    static synchronized JSArray pending(Context context) {
        JSArray results = new JSArray();
        File directory = new File(context.getFilesDir(), "recordings");
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) return results;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File file : files) {
            try {
                JSObject result = new JSObject(new String(new AtomicFile(file).readFully(), StandardCharsets.UTF_8));
                File source = sourceFile(context, result.getString("path"));
                if (!source.isFile() || source.length() == 0) continue;
                String audio = result.getString("audioPath");
                if (audio == null || !new File(audio).isFile()) result.put("audioPath", source.getAbsolutePath());
                results.put(result);
            } catch (Exception ignored) {
                // Never remove unrecognized or damaged files without acknowledgement.
            }
        }
        return results;
    }

    static synchronized void acknowledge(Context context, String path) throws IOException {
        File source = sourceFile(context, path);
        if ((RecordingService.recording || RecordingService.processing)
            && source.getAbsolutePath().equals(RecordingService.activePath)) {
            throw new IOException("录制仍在处理中，不能清理原始文件");
        }
        remove(new File(source.getAbsolutePath() + ".wav"));
        if (source.getName().endsWith(".mp4")) {
            remove(new File(source.getParentFile(), source.getName().replace(".mp4", "-audio.m4a")));
        }
        remove(source);
        new AtomicFile(new File(source.getAbsolutePath() + ".json")).delete();
        JSObject last = RecordingService.lastResult;
        if (last != null && source.getAbsolutePath().equals(last.getString("path"))) RecordingService.lastResult = null;
    }

    private static File sourceFile(Context context, String path) throws IOException {
        if (path == null) throw new IOException("缺少录制文件路径");
        File source = new File(path).getCanonicalFile();
        File directory = new File(context.getFilesDir(), "recordings").getCanonicalFile();
        if (!directory.equals(source.getParentFile())
            || !source.getName().matches("[0-9a-fA-F-]{36}\\.(mp4|m4a)")) {
            throw new IOException("只能处理声记本次生成的录制文件");
        }
        return source;
    }

    private static void remove(File file) throws IOException {
        if (file.exists() && !file.delete()) throw new IOException("无法清理已入库的录制副本：" + file.getName());
    }
}
