package io.shengji.recorder;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Only microphone and a fresh, visible Android screen-capture grant are used. */
@CapacitorPlugin(name = "NativeRecorder", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class NativeRecorderPlugin extends Plugin implements RecordingService.Listener {
    private PluginCall startCall;
    private PluginCall stopCall;

    @Override public void load() { RecordingService.listener = this; }

    @Override protected void handleOnDestroy() {
        if (RecordingService.listener == this) RecordingService.listener = null;
        super.handleOnDestroy();
    }

    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (startCall != null || RecordingService.recording || RecordingService.processing) {
                call.reject("当前录制尚未结束，请先停止或等待音频处理完成。");
                return;
            }
            String mode = call.getString("mode", "audio");
            if (!mode.equals("audio") && !mode.equals("screen")) {
                call.reject("不支持的录制模式。");
                return;
            }
            if (!Boolean.TRUE.equals(call.getBoolean("microphone", true))) {
                call.reject("Android 版本需要麦克风音频，才能生成逐字稿。");
                return;
            }
            startCall = call;
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                requestPermissionForAlias("microphone", call, "microphonePermission");
            } else {
                requestCapture(call);
            }
        });
    }

    @PermissionCallback private void microphonePermission(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            rejectStart("没有麦克风权限，未开始录制。");
            return;
        }
        requestCapture(call);
    }

    private void requestCapture(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 33
                && getPermissionState("notifications") != PermissionState.GRANTED
                && !getContext().getSharedPreferences("recorder", Context.MODE_PRIVATE).getBoolean("notificationsAsked", false)) {
                getContext().getSharedPreferences("recorder", Context.MODE_PRIVATE).edit().putBoolean("notificationsAsked", true).apply();
                requestPermissionForAlias("notifications", call, "notificationPermission");
                return;
            }
            if ("screen".equals(call.getString("mode"))) {
                MediaProjectionManager manager = (MediaProjectionManager)
                    getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                startActivityForResult(call, manager.createScreenCaptureIntent(), "screenPermission");
            } else {
                launchService("audio", 0, null);
            }
        } catch (Exception error) {
            rejectStart("无法申请录制权限：" + error.getMessage());
        }
    }

    @PermissionCallback private void notificationPermission(PluginCall call) {
        // Notification permission is optional; Android still exposes the active FGS
        // in its task manager when the user declines the notification drawer entry.
        requestCapture(call);
    }

    @ActivityCallback private void screenPermission(PluginCall call, ActivityResult result) {
        if (call == null || startCall == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            rejectStart("已取消屏幕录制，未保存任何录制内容。");
            return;
        }
        launchService("screen", result.getResultCode(), result.getData());
    }

    private void launchService(String mode, int resultCode, Intent data) {
        try {
            Intent intent = new Intent(getContext(), RecordingService.class)
                .setAction(RecordingService.START)
                .putExtra("mode", mode)
                .putExtra("resultCode", resultCode);
            if (data != null) intent.putExtra("projectionData", data);
            ContextCompat.startForegroundService(getContext(), intent);
        } catch (Exception error) {
            rejectStart("无法启动录制：" + error.getMessage());
        }
    }

    @PluginMethod public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (stopCall != null) {
                call.reject("正在停止并处理录音，请稍候。");
                return;
            }
            if (!RecordingService.recording && !RecordingService.processing) {
                if (RecordingService.lastResult != null) call.resolve(RecordingService.lastResult);
                else call.reject("没有正在进行的录制。");
                return;
            }
            stopCall = call;
            if (RecordingService.recording) {
                getContext().startService(new Intent(getContext(), RecordingService.class)
                    .setAction(RecordingService.STOP));
            }
        });
    }

    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("recording", RecordingService.recording);
        result.put("processing", RecordingService.processing);
        result.put("duration", RecordingService.elapsedSeconds());
        call.resolve(result);
    }

    @Override public void onStarted() {
        if (startCall != null) { startCall.resolve(); startCall = null; }
    }

    @Override public void onStopped(JSObject result) {
        if (stopCall != null) { stopCall.resolve(result); stopCall = null; }
        notifyListeners("recordingStopped", result, true);
    }

    @Override public void onError(String message) {
        rejectStart(message);
        if (stopCall != null) { stopCall.reject(message); stopCall = null; }
        JSObject result = new JSObject();
        result.put("message", message);
        notifyListeners("recordingError", result, true);
    }

    private void rejectStart(String message) {
        if (startCall != null) { startCall.reject(message); startCall = null; }
    }
}
