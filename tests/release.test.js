const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readPngSize = (file) => {
  const data = fs.readFileSync(path.join(root, file));
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

test("manifest uses minimized install-time permissions", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(manifest.options_ui.page, "options.html");
  assert.equal(manifest.homepage_url, "https://github.com/shawnzhang-lab/translatorx");
  assert.equal(
    packageJson.repository.url,
    "git+https://github.com/shawnzhang-lab/translatorx.git",
  );
  assert.equal(
    packageJson.bugs.url,
    "https://github.com/shawnzhang-lab/translatorx/issues",
  );
  assert.ok(!manifest.permissions.includes("activeTab"));
  assert.ok(manifest.host_permissions.includes("https://api.deepseek.com/*"));
  assert.equal(Object.hasOwn(manifest, "optional_host_permissions"), false);
  assert.equal(manifest.version, "1.5.14");
});

test("extension icons use the TranslatorX mascot at every declared size", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const expected = {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  };

  assert.deepEqual(manifest.icons, expected);
  assert.deepEqual(manifest.action.default_icon, expected);
  for (const [size, file] of Object.entries(expected)) {
    assert.deepEqual(readPngSize(file), [Number(size), Number(size)]);
  }

  const buttonAvatars = [
    "icons/translatorx-button-avatar-48.png",
    "icons/translatorx-success-ok-48.png",
  ];
  const exposedResources = new Set(
    manifest.web_accessible_resources.flatMap((entry) => entry.resources),
  );
  for (const file of buttonAvatars) {
    assert.deepEqual(readPngSize(file), [48, 48]);
    assert.ok(exposedResources.has(file));
  }

  const contentScript = read("content.js");
  assert.match(contentScript, /translatorx-button-avatar-48\.png/);
  assert.match(contentScript, /translatorx-success-ok-48\.png/);
  assert.match(contentScript, /showDigestOpenSuccess\(\)/);
  assert.match(contentScript, /label\.textContent = ui\("已打开", "Opened"\)/);
});

test("release copy documents current scope without em dashes", () => {
  const readme = read("README.md");
  const chineseReadme = read("README.zh-CN.md");
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.doesNotMatch(readme, /—/);
  assert.doesNotMatch(chineseReadme, /—/);
  assert.doesNotMatch(manifest.description, /—/);
  assert.doesNotMatch(packageJson.description, /—/);

  assert.equal(manifest.name, "TranslatorX");
  assert.equal(packageJson.name, "translatorx");
  assert.match(
    read("scripts/package-extension.sh"),
    /translatorx-v\$version\.zip/,
  );
  assert.match(read(".github/workflows/ci.yml"), /dist\/translatorx-v\*\.zip/);
  assert.match(
    read("scripts/package-extension.sh"),
    /Windows\/System32\/tar\.exe -a -c -f/,
  );
  assert.doesNotMatch(
    [
      read("PRIVACY.md"),
      read("SECURITY.md"),
      manifest.description,
      packageJson.description,
    ].join("\n"),
    /youtube translatorX|YouTube Digest|\bYT Digest\b/i,
  );
  assert.match(readme, /^# TranslatorX$/m);
  assert.match(
    readme,
    /Turn every YouTube video into a resource for deep learning\./,
  );
  assert.doesNotMatch(readme, /before deciding how much of it to watch/i);
  assert.match(readme, /^## Install with your coding agent$/m);
  assert.match(
    readme,
    /permanent folder I choose[\s\S]*tell me its exact full path[\s\S]*If I need a suggestion during this first installation[\s\S]*`~\/Documents\/translatorx`[\s\S]*`%USERPROFILE%\\Documents\\translatorx`[\s\S]*do not assume either path/,
  );
  assert.match(
    readme,
    /Moving or deleting the source folder breaks the unpacked extension until you load it again from the new location\./,
  );
  assert.match(
    readme,
    /selecting the exact project folder you chose in Chrome or Edge with \*\*Load unpacked\*\*/,
  );
  assert.match(
    readme,
    /Select the exact project folder you chose, which must contain `manifest\.json`/,
  );
  assert.match(readme, /github\.com\/shawnzhang-lab\/translatorx\/issues/i);
  assert.match(
    readme,
    /independent derivative of \[YouTube Digest by Zara Zhang\]/i,
  );
  const englishAttributionStart = readme.indexOf(
    "\n## Project lineage and attribution",
  );
  assert.ok(englishAttributionStart > 0);
  assert.doesNotMatch(
    readme.slice(0, englishAttributionStart),
    /zarazhangrui\/youtube-digest/i,
  );
  assert.doesNotMatch(readme, /^## Contributing$/m);
  assert.match(chineseReadme, /^# TranslatorX$/m);
  assert.match(chineseReadme, /把每个 YouTube 视频变成一份可以深入学习的资料/);
  assert.match(chineseReadme, /^## 让你的编程 Agent 帮你安装$/m);
  assert.match(
    chineseReadme,
    /我选择的长期保留文件夹[\s\S]*告诉我准确的完整路径[\s\S]*第一次安装时需要位置建议[\s\S]*`~\/Documents\/translatorx`[\s\S]*`%USERPROFILE%\\Documents\\translatorx`[\s\S]*不要假设我一定使用这些路径/,
  );
  assert.match(
    chineseReadme,
    /如果移动或删除源代码文件夹，浏览器中加载的扩展会失效，需要从新的位置重新加载。/,
  );
  assert.match(
    chineseReadme,
    /“加载已解压的扩展程序”选择你刚才确定的那个准确项目文件夹/,
  );
  assert.match(
    chineseReadme,
    /选择你刚才确定的那个准确项目文件夹，其中必须包含 `manifest\.json`/,
  );
  assert.match(chineseReadme, /github\.com\/shawnzhang-lab\/translatorx\/issues/i);
  assert.match(chineseReadme, /独立衍生项目/);
  const chineseAttributionStart = chineseReadme.indexOf("\n## 项目来源与署名");
  assert.ok(chineseAttributionStart > 0);
  assert.doesNotMatch(
    chineseReadme.slice(0, chineseAttributionStart),
    /zarazhangrui\/youtube-digest/i,
  );
  assert.match(chineseReadme, /增加更多翻译语言/);
  assert.match(
    readme,
    /`chrome:\/\/extensions` in Chrome or `edge:\/\/extensions` in Edge/,
  );
  assert.match(
    chineseReadme,
    /Chrome 使用 `chrome:\/\/extensions`，Edge 使用 `edge:\/\/extensions`/,
  );
  assert.match(
    readme,
    /Google Chrome 116 or newer and current Microsoft Edge releases/,
  );
  assert.match(
    chineseReadme,
    /Chrome 116 或更高版本，以及支持 Side Panel API 的当前 Microsoft Edge 版本/,
  );

  const notice = read("NOTICE");
  assert.match(notice, /YouTube Digest/);
  assert.match(notice, /Zara Zhang/);
  assert.match(notice, /MIT License/);
  assert.match(read("scripts/check-release.sh"), /"NOTICE"/);

  assert.match(readme, /100 credits per month/i);
  assert.match(readme, /optional \*\*Supadata API key\*\*/i);
  assert.match(
    readme,
    /captions directly from the open YouTube player[\s\S]*Supadata is not contacted/,
  );
  assert.match(readme, /native transcript request uses \*\*1 credit\*\*/i);
  assert.match(readme, /generated transcript costs \*\*2 credits per video minute\*\*/i);
  assert.match(readme, /HTTP `206` still uses \*\*1 credit\*\*/i);
  assert.match(readme, /forces `mode=native`/i);
  assert.match(readme, /roughly 100 transcript lookups per month/i);
  assert.match(readme, /supadata\.ai\/pricing/i);
  assert.match(readme, /docs\.supadata\.ai\/get-transcript/i);
  assert.match(readme, /dash\.supadata\.ai\/auth\/sign-up/i);
  assert.match(readme, /platform\.deepseek\.com\/api_keys/i);
  assert.match(readme, /api-docs\.deepseek\.com/i);
  assert.match(readme, /api-docs\.deepseek\.com\/quick_start\/pricing/i);
  assert.match(readme, /api-docs\.deepseek\.com\/quick_start\/token_usage/i);
  assert.match(readme, /api-docs\.deepseek\.com\/guides\/kv_cache/i);
  assert.match(readme, /\$0\.0028[\s\S]*\$0\.14[\s\S]*\$0\.28/);
  assert.match(readme, /2,935 spoken English words/i);
  assert.match(readme, /about 32,600 input tokens/i);
  assert.match(readme, /\$0\.002[^\n]*\$0\.006 USD/i);
  assert.match(chineseReadme, /api-docs\.deepseek\.com\/quick_start\/pricing/i);
  assert.match(chineseReadme, /api-docs\.deepseek\.com\/quick_start\/token_usage/i);
  assert.match(chineseReadme, /api-docs\.deepseek\.com\/guides\/kv_cache/i);
  assert.match(chineseReadme, /\u00a50\.02[\s\S]*\u00a51[\s\S]*\u00a52/);
  assert.match(chineseReadme, /2,935 \u4e2a\u82f1\u6587\u53e3\u8bed\u8bcd/);
  assert.match(chineseReadme, /\u7ea6 32,600 \u4e2a\u8f93\u5165 token/);
  assert.match(chineseReadme, /\$0\.002[^\n]*\$0\.006 USD/);
  assert.match(chineseReadme, /dash\.supadata\.ai\/auth\/sign-up/i);
  assert.match(chineseReadme, /可选的 \*\*Supadata API Key\*\*/);
  assert.match(chineseReadme, /直接读取成功时不会联系 Supadata/);
  assert.match(chineseReadme, /platform\.deepseek\.com\/api_keys/i);
  assert.match(readme, /^### The TranslatorX button is missing on a YouTube video$/m);
  assert.match(
    chineseReadme,
    /^### YouTube 视频页面没有显示 TranslatorX 按钮$/m,
  );

  const optionsPage = read("options.html");
  const optionsStyles = read("options.css");
  const optionsScript = read("options.js");
  const sidepanelStyles = read("sidepanel.css");
  assert.match(optionsPage, /dash\.supadata\.ai\/auth\/sign-up/i);
  assert.match(optionsPage, /href="https:\/\/supadata\.ai\/"/i);
  assert.match(optionsPage, /href="https:\/\/docs\.supadata\.ai\/get-transcript"/i);
  assert.match(optionsPage, /Supadata API key \(optional\)/);
  assert.match(optionsPage, /contacted only if direct retrieval fails/);
  assert.match(optionsPage, /TranslatorX Settings/);
  assert.match(optionsPage, /使用你自己的 API Key/);
  assert.match(optionsPage, /字幕备用服务/);
  assert.match(optionsPage, /AI 服务商/);
  assert.match(optionsPage, /保存设置/);
  assert.match(optionsPage, /本地数据/);
  assert.match(optionsPage, /lang="en"/);
  assert.match(optionsScript, /ui\("正在保存…", "Saving…"\)/);
  assert.match(optionsScript, /ui\("请填写 DeepSeek API Key。", "Add a DeepSeek API key\."\)/);
  assert.match(read("sidepanel.html"), /<span lang="zh-CN">设置<\/span><span lang="en">Settings<\/span>/);
  assert.match(read("sidepanel.html"), />字幕<[\s\S]*?>Transcript</);
  assert.match(read("sidepanel.html"), />概览<[\s\S]*?>Overview</);
  assert.match(read("sidepanel.html"), />笔记<[\s\S]*?>Notes</);
  assert.match(read("sidepanel.js"), /ui\("缺少 API Key", "API Key Missing"\)/);
  assert.match(read("sidepanel.js"), /ui\("打开设置", "Open Settings"\)/);
  assert.match(optionsPage, /platform\.deepseek\.com\/api_keys/i);
  assert.match(optionsPage, /href="https:\/\/www\.deepseek\.com\/"/i);
  assert.match(optionsPage, /href="https:\/\/api-docs\.deepseek\.com\/"/i);
  assert.match(optionsPage, /<span lang="zh-CN">官网<\/span><span lang="en">Official site<\/span>/);
  assert.match(optionsPage, /<span lang="zh-CN">获取 Key<\/span><span lang="en">Get API key<\/span>/);
  assert.match(optionsPage, /<span lang="zh-CN">API 文档<\/span><span lang="en">API docs<\/span>/);
  assert.doesNotMatch(optionsPage, /<select\b/i);
  assert.doesNotMatch(optionsPage, /id="(?:provider|aiBaseUrl|aiModel)"/);
  assert.doesNotMatch(optionsPage, /customization|local remix|其他 AI 模型/i);
  assert.doesNotMatch(optionsStyles, /customization|agent-badge/i);
  assert.match(optionsStyles, /\.data-card\s*\{[^}]*margin-top:\s*36px;/);
  assert.doesNotMatch(optionsScript, /customization|copyCustomizationPrompt/i);
  assert.match(optionsScript, /migration\.migrated[\s\S]*chrome\.storage\.local\.set/);
  assert.doesNotMatch(optionsScript, /Add a Supadata API key/);
  assert.match(
    sidepanelStyles,
    /url\("icons\/translatorx-waiting-sprite\.png"\)/,
  );
  assert.match(sidepanelStyles, /@keyframes translatorxMascotFrames/);
  assert.ok(
    fs.existsSync(path.join(root, "icons/translatorx-waiting-sprite.png")),
  );
  assert.match(
    read("scripts/check-release.sh"),
    /icons\/translatorx-waiting-sprite\.png/,
  );
  assert.match(
    sidepanelStyles,
    /url\("icons\/translatorx-thinking-192\.png"\)/,
  );
  assert.match(sidepanelStyles, /@keyframes explainThinkingBob/);
  assert.match(
    sidepanelStyles,
    /#transcriptList\.is-following-playback[\s\S]*min-height:\s*clamp\(148px, 21vh, 188px\)/,
  );
  assert.match(
    sidepanelStyles,
    /#transcriptList\.is-following-playback[\s\S]*\.transcript-text\s*\{[\s\S]*font-size:\s*15px/,
  );
  assert.doesNotMatch(sidepanelStyles, /transcript-source-badge|source-dot--subs/);
  assert.doesNotMatch(
    read("sidepanel.js"),
    /transcriptSourceBadge|getTranscriptSourceLabel|Supadata 备用|Supadata fallback/,
  );
  assert.ok(
    fs.existsSync(path.join(root, "icons/translatorx-thinking-192.png")),
  );
  assert.match(
    read("scripts/check-release.sh"),
    /icons\/translatorx-thinking-192\.png/,
  );
  assert.match(read("sidepanel.js"), /renderExplainWaitingState/);
  assert.match(read("sidepanel.js"), /setInterval\([\s\S]*2600\)/);

  assert.match(readme, /^## Remix it with your coding agent$/m);
  assert.match(readme, /more translation languages/i);
  assert.match(readme, /customized summary templates/i);
  assert.match(readme, /vocabulary notebook/i);

  const publishedDocs = [
    readme,
    chineseReadme,
    read("PRIVACY.md"),
    read("SECURITY.md"),
  ].join("\n");
  assert.doesNotMatch(publishedDocs, /custom OpenAI-compatible/i);
  assert.doesNotMatch(publishedDocs, /optional custom-origin/i);
  assert.doesNotMatch(publishedDocs, /chosen AI provider/i);
  assert.doesNotMatch(publishedDocs, /configure a different OpenAI-compatible/i);
  assert.match(readme, /published version supports DeepSeek V4 Flash as its only AI provider/i);
  assert.match(chineseReadme, /发布版本只支持 DeepSeek V4 Flash/);
});

test("notes filters preserve selected contrast and expose pressed state", () => {
  const html = read("sidepanel.html");
  const css = read("sidepanel.css");
  const js = read("sidepanel.js");

  assert.match(
    html,
    /id="notesFilterThis"[\s\S]*?aria-pressed="true"[\s\S]*?>[\s\S]*?<span lang="zh-CN">当前视频<\/span><span lang="en">This Video<\/span>/,
  );
  assert.match(
    html,
    /id="notesFilterAll"[\s\S]*?aria-pressed="false"[\s\S]*?>[\s\S]*?<span lang="zh-CN">全部笔记<\/span><span lang="en">All Notes<\/span>/,
  );
  assert.match(
    css,
    /\.notes-filter \.enhance-btn\.active:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--accent-hover\);[^}]*color:\s*white;/,
  );
  assert.match(
    css,
    /\.notes-filter \.enhance-btn:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-secondary\);/,
  );
  assert.match(css, /\.notes-filter \.enhance-btn:focus-visible\s*\{[^}]*outline:/);
  assert.match(js, /setNotesFilter\(false\)/);
  assert.match(js, /setNotesFilter\(true\)/);
  assert.match(js, /setAttribute\("aria-pressed", String\(!showAll\)\)/);
  assert.match(js, /setAttribute\("aria-pressed", String\(showAll\)\)/);
});

test("runtime has no source-file credential dependency or retired model", () => {
  const runtime = [
    "background.js",
    "content.js",
    "sidepanel.js",
    "options.js",
    "settings.js",
  ]
    .map(read)
    .join("\n");

  assert.doesNotMatch(runtime, /\bCONFIG\./);
  assert.doesNotMatch(runtime, /importScripts\(["']config\.js/);
  assert.doesNotMatch(runtime, /\bdeepseek-chat\b/);
  assert.match(runtime, /deepseek-v4-flash/);
});

test("retired Remix and reader files are absent", () => {
  for (const file of [
    "reader.html",
    "reader.js",
    "remix-prompts.js",
    "config.example.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});

test("published prompt files contain runtime sections", () => {
  const expectedSections = {
    "prompts/analysis.md": ["System prompt", "User prompt"],
    "prompts/explain.md": ["System prompt", "User prompt"],
    "prompts/note-cleanup.md": ["System prompt", "User prompt"],
    "prompts/translation.md": [
      "Shared base rules",
      "Chinese rules",
      "Transcript batch translation",
      "Overview and notes translation",
    ],
  };

  for (const [file, sections] of Object.entries(expectedSections)) {
    const markdown = read(file);
    for (const section of sections) {
      assert.match(markdown, new RegExp(`^## ${section}$`, "m"));
    }
  }
});
