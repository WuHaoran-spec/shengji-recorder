# 验证方式

## 自动检查

```bash
npm ci
npm run model:prepare
npm test
npm run build
npm run test:desktop
```

桌面 smoke 使用独立临时资料库，不读取现有录制记录。它检查应用界面、本地模型清单、WASM MIME、安全上下文、沙箱、Node 隔离、网络阻断和屏幕来源校验；然后使用 Chromium 的合成麦克风设备验证录音与保存，同时确认摄像头请求被拒绝。测试不会打开真实麦克风。

Windows 的网页交互测试还可以运行 `npm run test:e2e`，使用本机 Edge 的无头模式检查导入、逐字稿修改、Word 文档内容、资料持久化及模拟录制。

## 选择性本机端到端检查

下列 PowerShell 命令仅用于开发验证：

```powershell
# 真正的窗口录屏：只选择本次测试应用自身的窗口 ID，不录桌面或声音。
$env:SHENGJI_TEST_SCREEN = '1'

# 自己准备的非敏感英文测试 WAV。预期内容须包含 "quick brown fox"。
$env:SHENGJI_TEST_AUDIO = 'C:\path\to\offline-speech.wav'

# 可选：使用打包后的应用，留空则使用当前 Electron 开发启动器。
$env:SHENGJI_TEST_EXECUTABLE = (Resolve-Path 'release\win-unpacked\ShengJi.exe').Path
node electron/smoke.cjs
```

屏幕测试在精确匹配本次窗口 ID 与标题后才开始，录制内容仅保留在测试进程内存中。语音测试会通过应用界面导入测试音频、执行真实本地模型识别、检查识别文字并导出 Word；结果文件保存在临时资料库中，测试结束后清理。

## 人工设备检查

自动检查与编译通过不能替代真实设备验收。发布前应在目标设备测试：麦克风授权、录屏授权与取消、通知停止、短录制回放、离线识别、文稿修改、Word 打开、文件导出、旋转／锁屏／后台切换以及低内存情形。

Android 的原生录屏、麦克风、通知、系统分享与 WebView 内存行为需要真机验收。使用手机前先录制一小段，确认设备上的完整流程可用。
