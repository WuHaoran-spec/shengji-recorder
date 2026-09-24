# 第三方组件与模型

本项目代码的 MIT 许可证不替代以下组件的许可证。实际依赖版本以 `package-lock.json` 为准，Android 依赖版本以 Gradle 文件为准。

| 组件 | 用途 | 上游许可证 / 来源 |
| --- | --- | --- |
| React / React DOM | 用户界面 | [MIT](https://github.com/facebook/react/blob/main/LICENSE) |
| Electron / Chromium | Windows 应用与媒体捕获 | [Electron MIT 及 Chromium 第三方许可](https://github.com/electron/electron/blob/main/LICENSE)；Electron 分发目录附带许可文件 |
| Capacitor | Android 应用桥接、文件与分享 | [MIT](https://github.com/ionic-team/capacitor/blob/main/LICENSE) |
| Transformers.js | 浏览器内模型推理与识别流水线 | [Apache-2.0](https://github.com/huggingface/transformers.js/blob/main/LICENSE) |
| ONNX Runtime Web | 本地 WebAssembly 推理引擎 | [MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) 与其第三方声明 |
| Xenova/whisper-tiny | Whisper 多语言量化 ONNX 模型 | [模型页声明 Apache-2.0](https://huggingface.co/Xenova/whisper-tiny) |
| OpenAI Whisper | 上述模型的上游研究与原始权重 | [MIT](https://github.com/openai/whisper/blob/main/LICENSE) |
| docx | 本机生成 Word 文档 | [MIT](https://github.com/dolanmiu/docx/blob/master/LICENSE) |
| idb | 本机 IndexedDB 存储 | [ISC](https://github.com/jakearchibald/idb/blob/main/LICENSE) |
| Lucide | 界面图标 | [ISC](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |

## 模型固定版本

- 模型：`Xenova/whisper-tiny`（多语言，而非 `.en` 英语专用版本）。
- 固定仓库修订：`5332fcc35e32a33b86612b9a57a89be7906102b1`。
- 使用量化编码器和合并解码器 ONNX 文件。ONNX 权重合计约 40.9 MB，另含分词器、配置与本地 WASM 引擎。
- `npm run model:prepare` 生成 `public/offline-manifest.json`，记录文件大小与 SHA-256。安装包中可据此核对模型内容。
- 构建时从上游下载；运行时仅加载包内文件。没有将模型权重重新训练为本项目私有模型，也没有将录音用于训练。

更换模型、量化格式或推理库后，应重新检查对应来源、版本、许可证、离线资源清单与设备内存需求。

## 官方实现参考

- [Electron 屏幕捕获与系统回放](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Electron 自定义协议](https://www.electronjs.org/docs/latest/api/protocol)
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)
- [Android MediaProjection](https://developer.android.com/media/grow/media-projection)
- [Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)

项目使用这些组件不代表获得其维护者背书。
