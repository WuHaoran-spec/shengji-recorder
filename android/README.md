# Android 原生录制说明

这是声记的 Capacitor 8 Android 工程，最低 Android 7（API 24），目标 API 36。
构建使用 JDK 21，先在项目根目录运行 `npm run model:prepare`、`npm run build`、`npx cap sync android`，再在此目录运行 `./gradlew assembleDebug`（Windows 使用 `gradlew.bat`）。

## 本机功能

- `NativeRecorder.start({ mode: 'audio' | 'screen', microphone: true })`：申请麦克风权限；录屏时另外显示 Android 屏幕共享授权。
- 音频：麦克风 AAC / M4A。录屏：H.264 / MP4 和麦克风 AAC，最长边至多 1920 像素。
- 录制通过前台服务持续执行；允许通知时，可在通知中停止。Android 13 及以上首次录制会可选申请通知权限，拒绝不阻止录音，系统仍显示活动服务。每一次屏幕录制都申请新的 MediaProjection 授权。
- 停止后将音频在本机解码为 16 kHz、单声道、PCM 16 位 WAV，供打包的离线转写模型使用。处理使用独立线程与流式文件读写。
- 原生服务也限制单次录制最长 30 分钟，避免界面进入后台后网页计时器暂停而继续无限录制。
- `stop()` 返回 `path`（原始文件）、`audioPath`（WAV）、`compressedAudioPath`（AAC 音频）、`duration`（秒）和 `mimeType`。可用 `Capacitor.convertFileSrc(path)` 读取。
- 如果用户通过通知或 Android 系统停止，插件也发送 `recordingStopped`；界面须按 `path` 去重，避免与 `stop()` 的返回值重复处理。
- 已完成的录制会先原子写入本机恢复信息。`pending()` 返回尚未确认入库的录制；界面只有在 IndexedDB 保存成功后才能调用 `acknowledge({ path })` 清理该录制的原生副本。重新打开应用可恢复尚未完成入库的录制。系统强制杀死进程时，尚未完成的 MP4 不保证可以恢复。
- 文件位于应用私有目录，应用没有 `INTERNET` 权限并关闭系统备份。只有用户主动导出时才通过 Android 分享功能交给其他应用。

Android 录屏音轨为**麦克风声音**，不捕捉其他应用的内部音频。某些受保护的界面可能显示黑屏。没有申请相机、通讯录、广泛存储或无障碍权限。

## 真机验收

原生录制、设备编码器和系统权限只能在真实设备或具备音频输入的模拟器上完整验证。发布前至少完成：

1. 飞行模式冷启动，打开已打包模型、录音、停止、自动逐字稿、导出 Word。
2. 第一次拒绝麦克风、随后允许；取消屏幕授权；连续录制两次，确保每次重新授权。
3. Android 14 或更新版本选择整屏/单应用，切出应用录制，然后从通知停止。
4. 按系统停止屏幕共享，以及录制中旋转设备，确认原视频可回放。
5. 至少 30 分钟录制，确认转换、逐字稿和导出，检查磁盘容量。
6. 用另一应用打开导出的 M4A / MP4 / DOCX；在系统应用详情中确认无网络权限。

调试 APK 可以直接安装，但其签名只用于开发，不等同于应用商店正式发布签名。
