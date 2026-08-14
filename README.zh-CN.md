# TranslatorX

[English](README.md) | [简体中文](README.zh-CN.md)

把每个 YouTube 视频变成一份可以深入学习的资料。TranslatorX 把字幕、双语翻译、AI 概览、内容讲解和时间戳笔记放进同一个 Chrome 侧边栏，让你可以持续学习视频中的知识和语言，同时不丢失原视频上下文。

- 把零碎字幕变成清晰、可搜索的学习资料。
- 字幕默认以中英双语打开，也可切换原文或简体中文；TranslatorX 会记住你上次选择的字幕视图。
- 预翻译开头 30 段字幕，同时优先翻译当前播放行和用户手动浏览到的字幕。
- 等待翻译时显示动态 TranslatorX-chan 图标，并从 100 条二次元等待文案中随机抽取提示。
- 通过 AI 概览、章节、重点引用和可切换英文、中文、双语视图的选中文本讲解建立系统理解，并自动记住默认讲解语言。
- 可在任意已保存笔记下补充自己的评论、联想和下一步行动。这些灵感只保存在 Chrome 本地，不会调用 AI API。
- 界面默认使用中文，可通过侧边栏和设置页右上角的 **English** 按钮切换为完整英文界面；这不会改变字幕或解释的输出语言。
- 点击字幕、概览或笔记中的时间戳，快速跳转到对应位置。
- 播放时自动滚动字幕，让当前正在朗读的字幕保持在视觉中央附近；使用滚轮、触摸、滚动条或键盘手动滚动时会暂停跟随。
- 保存自动润色的时间戳笔记，方便之后复习。
- 在中英文双语设置页中配置 API Key。
- 使用自己的 API Key，数据保存在本地 Chrome 中，不包含分析统计或行为追踪。

TranslatorX 是一个需要自行提供 API Key 的开源项目，通过 GitHub 安装。目前没有上架 Chrome 应用商店，不赠送 API 额度，也没有开发者运营的服务器。

## 让你的编程 Agent 帮你安装

你不需要看懂代码，也不需要会使用命令行。把下面这段话发送给你的编程 Agent：

> 请把 TranslatorX 下载或克隆到我选择的长期保留文件夹，告诉我准确的完整路径，并让 Chrome“加载已解压的扩展程序”使用同一个文件夹。如果我在第一次安装时需要位置建议，可以推荐 macOS 或 Linux 上的 `~/Documents/translatorx`，或 Windows 上的 `%USERPROFILE%\Documents\translatorx`，但不要假设我一定使用这些路径。请用简单易懂的语言一步一步指导我完成安装和配置。https://github.com/shawnzhang-lab/translatorx

你的 Agent 应该帮你：

1. 先询问你想把项目长期保存在哪里，再下载或克隆到那里，并告诉你准确的完整路径。如果你需要建议，可以推荐 macOS 或 Linux 上的 `~/Documents/translatorx`，或 Windows 上的 `%USERPROFILE%\Documents\translatorx`。
2. 打开 DeepSeek 官方页面，指导你创建必需的 AI 账号。只有需要可选字幕兜底时才打开 Supadata。
3. 指导你在 Chrome 中通过“加载已解压的扩展程序”选择你刚才确定的那个准确项目文件夹。
4. 告诉你应该在扩展的“设置”页面哪个位置填写 API Key。
5. 打开一个带字幕的 YouTube 视频，确认字幕和翻译功能可以使用。

安装后请让这个文件夹留在原位。如果移动或删除它，Chrome 中加载的本地扩展会失效，需要从新的长期存放位置重新加载。

不要把 API Key 发送到 AI 对话、源代码、截图或公开消息中。请你自己在 TranslatorX 的设置页面直接填写。编程 Agent 可以告诉你填写位置，但不需要看到 Key。

## 手动安装

如果你想自己操作：

1. 打开 [github.com/shawnzhang-lab/translatorx](https://github.com/shawnzhang-lab/translatorx)。
2. 点击 **Code**，再选择 **Download ZIP**。
3. 选择一个长期保留的文件夹，并把项目解压到这里。可选建议是 macOS 或 Linux 上的 `~/Documents/translatorx`，或 Windows 上的 `%USERPROFILE%\Documents\translatorx`。你也可以使用其他文件夹。
4. 在 Chrome 地址栏打开 `chrome://extensions`。
5. 打开右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择你刚才确定的那个准确项目文件夹，其中必须包含 `manifest.json`。
8. 如果需要，可以在 Chrome 扩展菜单中固定 TranslatorX。

这是一个本地加载的扩展，不会自动更新。下载新版或让 Agent 修改代码后，请在 `chrome://extensions` 中找到 TranslatorX 并点击“重新加载”，然后刷新已经打开的 YouTube 页面。如果移动或删除源代码文件夹，Chrome 中加载的扩展会失效，需要从新的位置重新加载。

## 设置 API Key

TranslatorX 的 AI 功能需要一个 Key，并支持一个可选的字幕兜底 Key：

1. **DeepSeek API Key**，用于生成概览、讲解内容、翻译和自动润色笔记。
2. 可选的 **Supadata API Key**，仅在无法直接读取 YouTube 字幕时用于兜底。

### 可选：获取 Supadata 兜底 API Key

TranslatorX 会先从当前打开的 YouTube 播放器直接读取人工字幕或自动生成字幕。直接读取成功时不会联系 Supadata，也不会消耗 Supadata credits。你可以将此设置留空。如需增加兜底能力：

1. 打开 Supadata 官方[注册页面](https://dash.supadata.ai/auth/sign-up)。
2. 创建账号并完成简短的新手引导。
3. Supadata 会在新手引导过程中自动生成 API Key。
4. 之后可以随时打开 [Supadata 控制台](https://dash.supadata.ai/)查找或管理 Key。
5. 复制 Key，并粘贴到 TranslatorX 设置中的 **Supadata API key**。

如果页面流程发生变化，请查看 [Supadata 官方文档](https://docs.supadata.ai/)。

### 获取 DeepSeek API Key

1. 打开 DeepSeek 官方 [API Keys 页面](https://platform.deepseek.com/api_keys)。
2. 按照提示登录，或创建 DeepSeek 开放平台账号。
3. 点击 **Create new API key**，填写容易识别的名称，例如 `TranslatorX`，然后创建 Key。
4. 立即复制 Key。完整 Key 可能只会显示一次。
5. 把 Key 粘贴到 TranslatorX 设置中的 **DeepSeek API key**。
6. 如果 DeepSeek 提示余额不足，请在 DeepSeek 开放平台账号中充值后再试。

当前账号和接口说明请查看 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/)。

在侧边栏中打开 **Settings**。你也可以在 `chrome://extensions` 的 TranslatorX 卡片中打开扩展选项。Key 只能粘贴到这些设置输入框中。不要把 Key 发送到 AI 对话、项目文件、截图或公开消息中。

发布版本只支持 DeepSeek V4 Flash：

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
```

TranslatorX 会让所有 DeepSeek 请求使用非思考模式，以获得更快、更稳定的交互。设置中的接口地址和模型固定，只需要填写 DeepSeek API Key。

API Key 和设置保存在你设备上的 Chrome 扩展本地存储中。发布包不会包含或使用 `config.js`。

## 使用 TranslatorX

1. 打开一个有字幕的普通 YouTube 视频页面。
2. 点击 TranslatorX 扩展图标，打开侧边栏。
3. 默认以双语视图阅读带时间戳的字幕，也可选择 **Original**、**中文**、**双语**；TranslatorX 会记住你的选择。
   当前朗读字幕会自动保持在视觉中央附近。手动滚动可以暂停，点击 **跟随当前字幕** 即可恢复。
4. 打开 **Overview**，查看 AI 生成的章节和重点引用。
5. 选中字幕获取 AI 内容讲解，再选择 **English**、**中文** 或 **双语**。该选择会成为下次讲解的默认语言。
6. 从播放器或重点引用中保存笔记，之后可以在 **Notes** 中查看。点击笔记卡片，即可在视频原文下方补充个人灵感。

## 当前支持范围

- Chrome 116 或更高版本。
- 标准的 `youtube.com/watch` 视频页面。
- 从当前 YouTube 播放器直接读取的人工字幕和自动生成字幕。TranslatorX 会优先使用英文字幕，也可能显示其他可用语言。
- 如果直接读取失败并且配置了 Key，可以使用 Supadata 兜底。
- 字幕、AI 概览和已保存笔记均支持原文、简体中文和双语对照视图。
- AI 概览、可保存默认语言的中英双语选中文本讲解、翻译和自动润色笔记。
- 带个人灵感的本地笔记，以及最近字幕、概览和翻译的本地缓存。
- 发布版本的所有 AI 功能都使用 DeepSeek V4 Flash。其他服务需要修改本地代码，不属于发布版本的支持范围。

Shorts、直播、私密视频、受访问限制的视频，以及没有原生字幕的视频可能无法使用。目前没有测试 Firefox、Safari、移动浏览器或其他 Chromium 浏览器。

使用可选的 Supadata 兜底时，TranslatorX 会强制使用 `mode=native`，不会在没有原生字幕时请求 AI 生成转录，也不会在本地转录音频。

## Supadata 免费额度和请求成本

截至 2026 年 8 月 9 日，[Supadata 价格页面](https://supadata.ai/pricing)显示免费版每月提供 **100 credits**，不需要信用卡，未使用的额度不会结转。价格可能变化，使用前请查看最新页面。

[Supadata 字幕接口文档](https://docs.supadata.ai/get-transcript)说明了不同模式的计费方式：

- 获取一次原生字幕消耗 **1 credit**，与视频时长无关。
- AI 生成字幕每分钟消耗 **2 credits**。TranslatorX 不会使用这条路径，因为它强制使用 `mode=native`。
- 如果没有可用原生字幕并返回 HTTP `206`，仍会消耗 **1 credit**。

按照当前优先直接读取字幕的方式，成功从 YouTube 读取字幕的视频不会消耗 Supadata credits。如果每次兜底请求都成功，免费版每月大约可以完成 100 次字幕查询。重试和没有字幕的查询也会消耗额度，所以实际成功数量可能更少。

DeepSeek 的额度与 Supadata 分开计算。DeepSeek 可能有自己的免费额度、限速或费用。TranslatorX 不收款，也不转售 API 服务。建议为两个账号设置消费上限并定期查看用量。下方估算说明了当前 DeepSeek 翻译成本。

## DeepSeek V4 Flash 翻译成本估算

截至 2026 年 8 月 10 日，DeepSeek 官方[价格页面](https://api-docs.deepseek.com/quick_start/pricing/)列出的每 100 万 token 价格是：

- 缓存命中输入：**¥0.02**。
- 缓存未命中输入：**¥1**。
- 输出：**¥2**。

DeepSeek 说明这些价格可能很快上调，因此使用此估算前必须查看当前价格页面。官方 [token 用量指南](https://api-docs.deepseek.com/quick_start/token_usage/)估算每个英文字符约为 0.3 token，每个中文字符约为 0.6 token。[上下文缓存指南](https://api-docs.deepseek.com/guides/kv_cache/)说明了重复前缀使用的自动尽力而为磁盘缓存。

一个实测的 20 分钟英文演讲包含 **2,935 个英文口语词**和 15,433 个字幕字符。按 TranslatorX 当前的分组方式，它会变成 128 个语义分段，以每次 3 段的方式发出 43 次请求。算上重复 prompt 和 JSON 后，渲染后的输入约为 108,528 个英文字符，按官方每个英文字符 0.3 token 的经验值，即**约 32,600 个输入 token**。按每个中文字符 0.6 token 的经验值，再加上 JSON 和 ID 开销，中文 JSON 输出估计为 3,500 到 4,500 token。

如果所有输入都按缓存未命中计费，输入约 $0.0046，输出约 $0.0010 到 $0.0013，总计约 $0.0056 到 $0.0059。当大量重复的 system prompt 命中 DeepSeek 自动尽力而为缓存时，更现实的低值约为 $0.002 到 $0.003。完整翻译这段演讲的实用估算是 **$0.002 到 $0.006 USD，约 ¥0.02 到 ¥0.04**。

翻译是延迟按需和渐进式的。已缓存的分段会复用，只有滚动到并请求的字幕行才会发起调用。重试、服务商行为和价格变化都可能增加最终成本。

## 用编程 Agent 改造成自己的版本

TranslatorX 目前由维护者主导开发。如果发现可以复现的 Bug，或希望建议新功能，请使用本仓库的 [Issues](https://github.com/shawnzhang-lab/translatorx/issues)。对于较大的改动，请先建立 Issue 讨论，再准备 Pull Request。你也可以下载或 Fork 自己的副本，让编程 Agent 帮你修复、改造和个性化。

TranslatorX 使用原生 HTML、CSS 和 JavaScript，没有构建步骤，很适合用编程 Agent 做个人项目。你可以尝试：

- 增加更多翻译语言，并让每个人选择自己的学习语言。
- 为课程、访谈、教程、测评或研究视频增加自定义总结模板。
- 增加生词本，保存单词、原句、解释和视频时间戳。
- 把笔记和生词导出到 Markdown、CSV、Anki 或其他学习工具。
- 增加个人主题筛选，只突出与你目标相关的章节。
- 增加本地模型选项，获得不同的隐私和成本方案。
- 改善键盘操作、字体大小和高对比度等无障碍体验。

请让 Agent 保留用户自带 API Key 的模式，不要把秘密写入源代码，并运行下方检查。分享自己的版本前，也要在真实视频上测试。

## 隐私和数据流向

TranslatorX 会直接从扩展向服务商发送请求：

1. 先直接读取 YouTube 提供的可用字幕轨道。只有直接读取失败并且你配置了可选兜底时，才会把标准化的视频地址发送给 Supadata 请求原生字幕。
2. 当你使用 AI 功能时，把字幕和相关视频信息发送给 DeepSeek。
3. 翻译或讲解等功能只发送当前需要的内容，例如选中的文本和上下文，或少量字幕分段。
4. API Key、设置、笔记和最近缓存保存在 Chrome 本地。

TranslatorX 没有账号系统、广告、分析统计或行为追踪。YouTube 和你实际启用的可选服务仍会按照各自的条款和隐私政策处理数据。详情请查看 [PRIVACY.md](PRIVACY.md)。

## 常见问题

### YouTube 视频页面没有显示 TranslatorX 按钮

- 在 `chrome://extensions` 中找到 TranslatorX，点击“重新加载”，然后刷新 YouTube 页面。
- 确认当前页面是标准 `https://www.youtube.com/watch?...` 页面，而不是 Shorts、嵌入页面或直播页面。
- 当前版本会在 YouTube 响应式操作栏变化时自动重新定位按钮。页面加载完成后可以稍等片刻。
- 如果你使用的是较早下载的版本，可以先横向调整一次 YouTube 窗口宽度让按钮出现，然后下载最新版，这样之后不再需要调整窗口。
- 如果按钮仍然没有出现，让你的编程 Agent 在这个具体视频页面检查 content script。

### 侧边栏无法打开

- 确认你打开的是标准 `https://www.youtube.com/watch?...` 页面。
- 在 `chrome://extensions` 中确认 TranslatorX 已启用，并点击“重新加载”。
- 重新加载扩展后，刷新 YouTube 页面。
- 如果问题仍然存在，让你的编程 Agent 检查扩展。

### TranslatorX 提示需要设置

- 打开 **Settings**，保存 DeepSeek Key。只有需要字幕兜底能力时才填写 Supadata Key。
- 发布版本固定使用 DeepSeek V4 Flash，没有需要填写的 Base URL 或 Model 字段。
- 如果设置提示旧的自定义服务已移除，请重新填写 DeepSeek Key。旧 AI Key 已安全清除，避免被错误用于 DeepSeek。

### 找不到字幕

- 确认视频是公开的，并且有原生字幕。
- 如果配置了可选兜底，请检查 Supadata Key、剩余额度、限速和账号状态；如果没有配置，可以为无法直接读取字幕的视频增加 Supadata Key。
- 没有字幕的查询和手动重试也可能消耗额度。

TranslatorX 不会自动改用 AI 生成字幕。

### AI 请求失败

- `401` 或 `403` 通常表示 DeepSeek Key 或账号权限有问题。
- `429` 通常表示达到了 DeepSeek 服务限速或消费上限。
- 确认 Key 来自上方链接的 DeepSeek 开放平台账号，并且账号有可用额度。
- 如果你把本地副本改成了其他模型，请让编程 Agent 检查本地实现。

不要在对话、截图或日志中分享 API Key、私密字幕或个人笔记。

## 给编程 Agent 的检查命令

修改项目后，让你的编程 Agent 运行：

```bash
npm test
npm run check
npm run package
```

Agent 还应该在 Chrome 中重新加载扩展，并测试多个真实 YouTube 视频。自动检查通过，不代表真实服务请求和 YouTube 交互一定正常。

## 项目来源与署名

TranslatorX 是基于 [Zara Zhang 的 YouTube Digest](https://github.com/zarazhangrui/youtube-digest) 开发的独立衍生项目，并依照 MIT 许可证使用。TranslatorX 的安装、发布、支持和后续开发均以当前仓库为准；原作者的版权和许可证声明会完整保留。详见 [NOTICE](NOTICE) 与 [LICENSE](LICENSE)。

## 开源许可

MIT，详见 [LICENSE](LICENSE)。
