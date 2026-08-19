# TranslatorX

[English](README.md) | [简体中文](README.zh-CN.md)

Turn every YouTube video into a resource for deep learning. TranslatorX brings transcripts, bilingual translation, AI overviews, explanations, and timestamped notes into one Chromium side panel, so you can study ideas and language without losing your place.

- Turn captions into a readable, searchable learning resource.
- Open transcripts in bilingual mode by default, then switch between the original text, Simplified Chinese, and an aligned bilingual view. TranslatorX remembers the transcript view you last selected.
- Prefetch the first 30 transcript segments, while giving the current playback line and manually browsed rows immediate translation priority.
- Enjoy an animated TranslatorX-chan mascot and 100 randomized anime-style messages while translation is pending.
- Build understanding with an AI overview, chapters, key quotes, and selected-text explanations that switch between English, Simplified Chinese, and bilingual views while remembering your default.
- Add your own comments, connections, and next actions beneath any saved note. These reflections stay in local browser storage and do not call the AI API.
- Navigate long videos by clicking timestamps in the transcript, overview, or notes.
- Follow playback automatically while keeping the currently spoken subtitle near the visual center; wheel, touch, scrollbar, or keyboard scrolling pauses following until you resume it.
- Save polished timestamped notes for later study.
- Use the interface in Chinese by default, or switch the side panel and Settings page to English with one button.
- Keep control of your data with your own API keys, local browser storage, and no analytics or telemetry.

TranslatorX is a bring-your-own-key project installed locally from GitHub. It is not available through the Chrome Web Store or Microsoft Edge Add-ons, does not include API credits, and does not run a developer-operated server.

## Install with your coding agent

You do not need to understand the code or use the command line. Send this message to your coding agent:

> Download or clone TranslatorX into a permanent folder I choose, tell me its exact full path, and use that same folder for the browser's Load unpacked step in Chrome or Edge. If I need a suggestion during this first installation, offer `~/Documents/translatorx` on macOS or Linux, or `%USERPROFILE%\Documents\translatorx` on Windows, but do not assume either path. Walk me through installation and setup in simple terms. https://github.com/shawnzhang-lab/translatorx

Your agent should:

1. Ask where you want to keep the project, download or clone it there, and tell you the exact full path. If you want a suggestion, it can offer `~/Documents/translatorx` on macOS or Linux, or `%USERPROFILE%\Documents\translatorx` on Windows.
2. Open the official DeepSeek page and help you create the required AI account. Open Supadata only if you want the optional caption fallback.
3. Walk you through selecting the exact project folder you chose in Chrome or Edge with **Load unpacked**.
4. Show you where to enter your API keys in the extension's **Settings** page.
5. Open a YouTube video with captions and confirm the transcript and translation work.

Keep this folder in the same place after installation. If you move or delete it, the unpacked extension stops working until you load it again from its new permanent folder.

Never paste an API key into an AI chat, source file, screenshot, or public message. Enter keys yourself, directly in the TranslatorX Settings page. Your coding agent can point to the correct field without seeing the key.

## Install manually

If you prefer to do it yourself:

1. Open [github.com/shawnzhang-lab/translatorx](https://github.com/shawnzhang-lab/translatorx).
2. Choose **Code**, then **Download ZIP**.
3. Choose a permanent folder and unzip the project there. Optional suggestions are `~/Documents/translatorx` on macOS or Linux, or `%USERPROFILE%\Documents\translatorx` on Windows. You may use a different folder.
4. Open the extensions page: `chrome://extensions` in Chrome or `edge://extensions` in Edge.
5. Turn on **Developer mode**.
6. Click **Load unpacked**.
7. Select the exact project folder you chose, which must contain `manifest.json`.
8. Pin TranslatorX from the browser's Extensions menu if you want quick access.

Because this is an unpacked extension, it does not update automatically. After downloading an update or changing local files, click **Reload** on the TranslatorX card at `chrome://extensions` or `edge://extensions`, then refresh open YouTube tabs. Moving or deleting the source folder breaks the unpacked extension until you load it again from the new location.

## Set up your API keys

TranslatorX needs one key for AI features and supports one optional fallback key:

1. A **DeepSeek API key** for overviews, explanations, translation, and automatic note polishing.
2. An optional **Supadata API key** used only when direct YouTube caption retrieval fails.

### Optional: get a Supadata fallback key

TranslatorX first reads manual or automatically generated captions directly from the open YouTube player. When that succeeds, Supadata is not contacted and no Supadata credit is used. You may leave this field empty. To add fallback retrieval:

1. Open the official [Supadata sign-up page](https://dash.supadata.ai/auth/sign-up).
2. Create an account and complete the short onboarding flow.
3. Supadata generates an API key automatically during onboarding.
4. Open the [Supadata dashboard](https://dash.supadata.ai/) whenever you need to find or manage the key.
5. Copy the key and paste it into **Supadata API key** in TranslatorX Settings.

See the [official Supadata documentation](https://docs.supadata.ai/) if the dashboard flow changes.

### Get a DeepSeek API key

1. Open the official [DeepSeek API Keys page](https://platform.deepseek.com/api_keys).
2. Sign in or create a DeepSeek Platform account when prompted.
3. Choose **Create new API key**, give it a recognizable name such as `TranslatorX`, and create it.
4. Copy the key immediately. The full key may only be shown once.
5. Paste it into **DeepSeek API key** in TranslatorX Settings.
6. If DeepSeek reports insufficient balance, add credit in your DeepSeek Platform account and try again.

See the [official DeepSeek API documentation](https://api-docs.deepseek.com/) for current account and API details.

Open **Settings** from the side panel. You can also open the TranslatorX **Options** page from its card at `chrome://extensions` or `edge://extensions`, or by right-clicking its toolbar icon. Paste keys only into these Settings fields. Never paste a key into an AI chat, repository file, screenshot, or public message.

The published version supports DeepSeek V4 Flash as its only AI provider:

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
```

TranslatorX sends every DeepSeek request in non-thinking mode for responsive, predictable interactions. The endpoint and model are fixed in Settings, so the only AI credential you enter is your DeepSeek API key.

Keys and settings are stored in the browser's local extension storage on your device. Release builds do not include or use `config.js`.

## Use TranslatorX

1. Open a standard YouTube watch page with captions.
2. Click the TranslatorX extension icon to open the side panel.
3. Read the timestamped transcript in the default bilingual view, or choose **Original**, **中文**, or **双语**. Your choice is remembered.
   The currently spoken subtitle stays near the center automatically. Scroll manually to pause, then click **跟随当前字幕** to resume.
4. Open **Overview** when you want AI-generated chapters and key quotes.
5. Select transcript text when you want an AI explanation, then choose **English**, **中文**, or **双语**. That choice becomes the default for the next explanation.
6. Save a note from the player or a key quote, then revisit it from **Notes**. Click a note card to add a personal reflection beneath the captured source text.

## What works today

- Google Chrome 116 or newer and current Microsoft Edge releases using the Side Panel API. The same unpacked extension folder and installation steps are used in both browsers.
- Standard `youtube.com/watch` video pages.
- Manual and automatically generated subtitle tracks read directly from the open YouTube player. TranslatorX prefers English when available, but may show another available language.
- Optional Supadata fallback when direct caption retrieval fails and a key is configured.
- Original, Simplified Chinese, and aligned bilingual views for transcripts, AI overviews, and saved notes.
- AI overviews, bilingual selected-text explanations with a saved default language, translation, and automatic note polishing.
- Local notes with personal reflections, plus a local cache for recent transcript and digest results.
- DeepSeek V4 Flash for all published AI features. Other providers require a local code adaptation and are not supported by this published version.

Shorts, live streams, private or access-restricted videos, and videos without an available native transcript may not work. Firefox, Safari, mobile browsers, Brave, Vivaldi, Opera, and other Chromium browsers are not currently part of the formally tested support matrix.

When the optional fallback runs, TranslatorX forces Supadata's `mode=native`. It does not request AI-generated transcripts or perform local audio transcription when native captions are unavailable.

## Supadata free tier and request costs

Current as of August 9, 2026, the [Supadata pricing page](https://supadata.ai/pricing) lists a free tier with **100 credits per month**, no credit card required. Unused credits do not roll over. Supadata pricing can change, so check the current page before relying on these numbers.

The [Supadata transcript documentation](https://docs.supadata.ai/get-transcript) describes the transcript request modes and credit behavior:

- A native transcript request uses **1 credit**, regardless of video duration.
- A generated transcript costs **2 credits per video minute**. TranslatorX does not use this path because it forces `mode=native`.
- An unavailable native lookup returned as HTTP `206` still uses **1 credit**.

With the direct-first behavior, videos whose YouTube captions load successfully use no Supadata credits. The free tier can cover roughly 100 transcript lookups per month when each fallback request succeeds once. Retries and unavailable-caption lookups also consume credits, so actual successful-video coverage can be lower.

DeepSeek usage is separate from Supadata. DeepSeek may apply its own free quota, rate limits, or charges. TranslatorX does not collect payments or resell access. Set spending limits and monitor both accounts. The estimate below explains the current DeepSeek translation cost.

## DeepSeek V4 Flash translation cost estimate

Current as of August 10, 2026, DeepSeek lists the following prices per 1 million tokens on its official [pricing page](https://api-docs.deepseek.com/quick_start/pricing/):

- Cache-hit input: **$0.0028 USD**.
- Cache-miss input: **$0.14 USD**.
- Output: **$0.28 USD**.

DeepSeek says these prices may increase soon, so check the current pricing page before relying on this estimate. Its official [token usage guide](https://api-docs.deepseek.com/quick_start/token_usage/) estimates about 0.3 token per English character and about 0.6 token per Chinese character. Its [context caching guide](https://api-docs.deepseek.com/guides/kv_cache/) explains the automatic best-effort disk cache used for repeated prefixes.

A measured 20-minute English talk contained **2,935 spoken English words** and 15,433 transcript characters. With TranslatorX's current grouping, it became 128 semantic segments and 43 requests of three segments each. Repeated prompts and JSON brought the rendered input to about 108,528 English characters, or **about 32,600 input tokens** using DeepSeek's 0.3 token per English character heuristic. The translated Chinese JSON output is estimated at about 3,500 to 4,500 tokens using the 0.6 token per Chinese character heuristic, plus JSON and ID overhead.

If all input is billed as cache miss, input costs about $0.0046 and output costs about $0.0010 to $0.0013, for a total of about $0.0056 to $0.0059. When much of the repeated system prompt hits DeepSeek's automatic best-effort cache, a realistic lower end is about $0.002 to $0.003. A practical estimate for fully translating this talk is therefore **$0.002 to $0.006 USD, about ¥0.02 to ¥0.04**.

Translation is lazy and progressive. Cached segments are reused, and only rows you request by scrolling into them incur calls. Retries, provider behavior, and pricing changes can increase the final cost.

## Remix it with your coding agent

TranslatorX is currently maintainer-led. Use this repository's [Issues](https://github.com/shawnzhang-lab/translatorx/issues) to report a reproducible bug or propose a feature. For substantial changes, open an issue before preparing a pull request. You can also download or fork your own copy and ask your coding agent to fix, remix, or personalize it for you.

TranslatorX uses plain HTML, CSS, and JavaScript with no build step, so it is a friendly starting point for agent-assisted projects. Ideas to try:

- Add more translation languages and let each person choose a learning language.
- Create customized summary templates for lectures, interviews, tutorials, reviews, or research talks.
- Build a vocabulary notebook that saves a word, its sentence, meaning, and video timestamp.
- Export notes and vocabulary to Markdown, CSV, Anki, or another study tool.
- Add personal topic filters that highlight the chapters most relevant to a goal.
- Add optional local-model support for a different privacy and cost tradeoff.
- Improve accessibility with keyboard navigation, font controls, and higher-contrast themes.

Ask your agent to preserve the bring-your-own-key model, keep secrets out of source files, run the checks below, and test the remix on real videos.

## Privacy and data flow

TranslatorX makes provider requests directly from the extension:

1. It reads an available caption track directly from YouTube. Only when direct retrieval fails and you configured the optional fallback does it send the canonical watch URL to Supadata to request the native transcript.
2. It sends the transcript and relevant video metadata to DeepSeek when you request AI features.
3. Focused features send only the content they need, such as selected text with context or small transcript batches for translation.
4. It stores keys, settings, notes, and recent cache entries locally in the browser.

There is no TranslatorX account system, advertising, analytics, or telemetry. YouTube and any optional providers you use still receive data under their own terms and privacy policies. See [PRIVACY.md](PRIVACY.md) for details.

## Troubleshooting

### The TranslatorX button is missing on a YouTube video

- At `chrome://extensions` or `edge://extensions`, find TranslatorX and click **Reload**, then refresh the YouTube tab.
- Confirm that you are on a standard `https://www.youtube.com/watch?...` page, not a Short, embed, or live page.
- The current version automatically follows YouTube when its responsive action bar changes. Wait a moment after the page finishes loading.
- If you have an older downloaded copy, resizing the YouTube window horizontally once may reveal the button. Then download the latest version so resizing is no longer required.
- If it is still missing, ask your coding agent to inspect the content script on that exact video page.

### The side panel does not open

- Confirm that you are on a standard `https://www.youtube.com/watch?...` page.
- At `chrome://extensions` or `edge://extensions`, confirm TranslatorX is enabled and click **Reload**.
- Refresh the YouTube tab after reloading the extension.
- Ask your coding agent to inspect the extension if the problem continues.

### TranslatorX asks for setup

- Open **Settings** and save a DeepSeek key. Add a Supadata key only if you want the optional caption fallback.
- This published version uses the fixed DeepSeek V4 Flash endpoint and model. There are no Base URL or Model fields to configure.
- If Settings says a legacy custom provider was removed, enter a DeepSeek key. The old AI key was cleared so it could not be reused with the wrong service.

### No transcript is found

- Confirm the video is public and has native captions.
- If you configured the optional fallback, check your Supadata key, remaining credits, rate limit, and account status. If you did not, you can add a Supadata key to retry videos whose captions cannot be read directly.
- Remember that unavailable native lookups and manual retries may still consume credits.

TranslatorX will not fall back to generated transcription.

### AI requests fail

- A `401` or `403` usually means the DeepSeek key or account access is invalid.
- A `429` usually means a DeepSeek rate or spending limit was reached.
- Confirm the key was created in the DeepSeek Platform account linked above and that the account has available credit.
- If you adapted a local copy for another model, ask your coding agent to inspect that local implementation.

Never share API keys, private transcripts, or personal notes in chats, screenshots, or logs.

## Checks for coding agents

Ask your coding agent to run these commands after changing the project:

```bash
npm test
npm run check
npm run package
```

The agent should also reload the unpacked extension in Chrome or Edge and test several real YouTube videos. Automated checks do not prove that live provider requests and YouTube interactions work.

## Project lineage and attribution

TranslatorX is an independent derivative of [YouTube Digest by Zara Zhang](https://github.com/zarazhangrui/youtube-digest), used under the MIT License. Installation, releases, support, and ongoing development for TranslatorX belong to this repository. The original copyright and license notice remain intact. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

## License

MIT. See [LICENSE](LICENSE).
