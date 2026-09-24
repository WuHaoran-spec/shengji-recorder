# 声记 ShengJi

录屏、录音 → 本机离线逐字稿 → 可编辑的 Word 文档。

声记是一个 MIT 开源应用。Windows 版使用 Electron，Android 版使用 Capacitor 与原生录制服务；两端共用 React 界面和本地 Whisper 语音识别。**不需要账号、不需要 API Key，录制内容不上传云端。** 安装包附带识别模型，首次使用也不需要下载模型。

这是 **v0.1 预览版**。转写在录制结束后自动执行，暂不提供实时字幕、说话人分离或云端同步。识别结果需要人工校对。

[下载 Windows / Android 安装包](https://github.com/WuHaoran-spec/shengji-recorder/releases) · [构建状态](https://github.com/WuHaoran-spec/shengji-recorder/actions) · [问题反馈](https://github.com/WuHaoran-spec/shengji-recorder/issues)

## 平台与功能

| 功能 | Windows 10/11 x64 | Android 7.0+ |
| --- | --- | --- |
| 麦克风录音 | 支持 | 支持 |
| 录屏 | 选择屏幕或窗口 | 系统授权后录屏，常驻录制通知 |
| 录屏声音 | 麦克风 + Windows 系统回放 | 麦克风；暂不录制其他 App 的内部音频 |
| 离线逐字稿 | 支持，安装包内置模型 | 支持，安装包内置模型 |
| 修改逐字稿、时间戳 | 支持 | 支持 |
| 导出 Word `.docx` / 文本 | 支持 | 支持，可调用系统分享 |
| 导入音频重新转写 | 支持浏览器能够解码的格式 | 取决于设备 WebView 的解码能力 |

当前发布 Windows 免安装 `.exe` 和 Android 可侧载 `.apk`。**没有 iOS 安装包**：iOS 仍需单独实现录屏接入，并使用 macOS、Xcode 与 Apple 签名配置构建；当前仓库不能直接生成可用 iOS App。

## 下载与安装

1. 打开 [Releases](https://github.com/WuHaoran-spec/shengji-recorder/releases)，选择最新预览版，展开 **Assets**。
2. Windows 下载 `ShengJi-版本-windows-x64-portable.exe`，保存到电脑后运行。该版本未使用商业代码签名，系统可能显示未知发布者；请核对下载来源与 `SHA256SUMS.txt`。
3. Android 下载 `ShengJi-版本-android-dev.apk`，允许该下载来源安装应用后打开。它使用开发签名，适合测试侧载，未上架应用商店。CI 每次构建的开发签名可能不同；覆盖安装失败时，先导出重要资料，再卸载旧版安装。

不要下载页面中的 `Source code.zip` 来代替安装包；它是源码。安装包包含离线模型，文件体积明显大于源码。

Windows 校验命令：

```powershell
Get-FileHash .\ShengJi-0.1.0-windows-x64-portable.exe -Algorithm SHA256
```

## 使用

1. 选择「录音」或「录屏」，设置标题与转写语言。
2. 允许麦克风权限；录屏时选择要共享的屏幕／窗口，或同意 Android 的系统投屏授权。
3. 结束录制后，原始媒体会保存到本机，应用自动开始离线转写。首次加载模型和手机上的识别可能较慢；识别期间保持应用打开。
4. 校对、修改逐字稿，导出 Word 文档，或下载原始录音／视频备份。

## 当前边界

- 使用 Whisper tiny 多语言量化模型，优先控制安装体积和设备负担。中文、人名、数字、方言、重叠讲话与嘈杂环境中的准确率有限；“逐字稿”是自动识别结果，不保证逐字准确。
- 单次录制和导入按 **30 分钟**上限设计。转写需要在内存中解码音频，低内存设备请从短录音开始。
- 不是实时转写；不会自动区分说话人。时间戳是识别估计值。
- Android 录屏只采集麦克风声音；应用内部回放声音尚未实现。系统受保护画面可能呈黑屏。
- 当前不提供后台离线转写保证；录制服务与转写界面是不同部分。转写期间切换应用、锁屏或被系统回收可能中断任务。
- Windows 选定窗口时，系统回放音频可能包括其他应用的声音。佩戴耳机可减少麦克风与系统回放混音时的回声。
- 本机资料库不等于备份。卸载、清理应用数据、浏览器存储故障或录制过程中退出都可能造成丢失；重要资料请主动导出。

## 从源码运行

需要 Node.js 22、npm、Git。Android 构建另需 JDK 21、Android SDK 36 与相应构建工具。开发者首次安装依赖和准备模型需要联网；用户安装后的录制、转写、导出可离线完成。

```bash
git clone https://github.com/WuHaoran-spec/shengji-recorder.git
cd shengji-recorder
npm ci
npm run model:prepare
npm run build
npm run desktop
```

`model:prepare` 下载固定版本的模型并准备 ONNX Runtime Web 文件到 `public/`，随后 Vite 将它们复制进 `dist/`。这些较大的生成文件没有提交到 Git；请勿跳过这一步。

开发界面可运行 `npm run dev`。浏览器环境下的录屏与音频格式受浏览器支持范围限制；原生 Android 录制需在 Android 包内运行。

### 构建 Windows

在 Windows 执行：

```bash
npm run model:prepare
npm run build
npm test
node electron/smoke.cjs
npm run dist:win -- --publish never
```

生成文件位于 `release/`。当前目标为 x64 免安装可执行文件；源码可按需要增加签名和安装器。

### 构建 Android

```bash
npm run model:prepare
npm run build
npm run android:sync
cd android
# macOS / Linux
./gradlew assembleDebug
# Windows
.\gradlew.bat assembleDebug
```

输出为 `android/app/build/outputs/apk/debug/app-debug.apk`。用于正式分发或商店上架前，应配置自己持有并妥善备份的稳定发布密钥，再构建 release APK/AAB；不要把密钥提交到 Git。

## 自动发布

GitHub Actions 对主分支、PR 和手动运行构建两端。推送与 `package.json` 版本一致的 `v*` 标签后，只有 Windows 和 Android 构建都成功才创建 GitHub 预发布，附加 `.exe`、开发签名 `.apk` 与 SHA-256 校验文件。工作流默认只读，发布作业单独申请仓库内容写权限。

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 隐私与安全

音视频与逐字稿保存在设备本地，不内置遥测、登录、云端识别或自动更新服务。导出／分享之后，文件由用户选择的目标应用管理。桌面渲染进程禁用 Node 集成，启用沙箱、上下文隔离、内容安全策略，并阻断远程 HTTP(S)／WebSocket 请求。

请只录制你有权录制的内容，并在适当时告知参与者。详见 [隐私与数据说明](docs/PRIVACY.md)、[安全反馈](docs/SECURITY.md)、[依赖与模型许可](docs/THIRD_PARTY.md)。

## 许可证

本项目代码使用 [MIT License](LICENSE)。第三方库与随包模型保留各自许可证。欢迎通过 Issue / Pull Request 提交复现步骤、修复或改进。
