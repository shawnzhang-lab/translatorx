const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flushTaskQueue = () => new Promise((resolve) => setImmediate(resolve));

function loadSidepanelHelpers({
  sendMessage = () => Promise.resolve({}),
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
} = {}) {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    setInterval() {},
    clearInterval() {},
    IntersectionObserver: class {},
    CSS: { escape: (value) => value },
    window: { getSelection: () => null, close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => {
        let value = "";
        return {
          set textContent(text) {
            value = String(text);
          },
          get innerHTML() {
            return value
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;");
          },
        };
      },
    },
    chrome: {
      runtime: { onMessage: listeners, sendMessage },
      windows: { getCurrent: () => Promise.resolve({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("sidepanel.js"), sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

function loadBackgroundHelpers({
  settings = {
    provider: "deepseek",
    aiApiKey: "test-key",
    aiBaseUrl: "https://api.deepseek.com",
    aiModel: "deepseek-v4-flash",
  },
  fetchImpl = fetch,
  setTimeoutImpl = () => 0,
  clearTimeoutImpl = () => {},
  storageLocal = {},
  tabsApi = {},
  scriptingApi = {},
  sidePanelApi = {},
} = {}) {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    fetch: fetchImpl,
    AbortController,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    importScripts() {},
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async () => ({ ytd_settings: settings }),
          ...storageLocal,
        },
      },
      action: { onClicked: listeners },
      sidePanel: {
        setPanelBehavior() {},
        setOptions: () => Promise.resolve(),
        open: () => Promise.resolve(),
        ...sidePanelApi,
      },
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        openOptionsPage() {},
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
      },
      tabs: { onUpdated: listeners, onActivated: listeners, ...tabsApi },
      scripting: scriptingApi,
    },
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value,
      chatCompletionsUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("background.js"), sandbox);
  return sandbox.__YTD_TRANSLATION_TESTING__;
}

function createFakeTimers() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.active = false;
    },
    fireActive(delay) {
      const match = [...timers.entries()].find(
        ([, timer]) => timer.active && timer.delay === delay,
      );
      assert.ok(match, `Expected an active ${delay}ms timer`);
      match[1].active = false;
      match[1].callback();
    },
    activeCount(delay) {
      return [...timers.values()].filter(
        (timer) => timer.active && timer.delay === delay,
      ).length;
    },
    createdCount(delay) {
      return [...timers.values()].filter((timer) => timer.delay === delay).length;
    },
  };
}

function streamingResponse(chunks, { ok = true, status = 200 } = {}) {
  let index = 0;
  return {
    ok,
    status,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: chunks[index++] };
          },
          async cancel() {},
        };
      },
    },
  };
}

const encode = (value) => new TextEncoder().encode(value);
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("prompt loader accepts Windows CRLF markdown", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url) => {
      assert.match(url, /prompts\/translation\.md$/);
      return {
        ok: true,
        text: async () =>
          [
            "# Translation Prompts",
            "",
            "## Chinese rules",
            "",
            "```",
            "Use natural Simplified Chinese.",
            "```",
          ].join("\r\n"),
      };
    },
  });

  const prompt = await helpers.loadPromptSection(
    "translation.md",
    "Chinese rules",
  );
  assert.equal(prompt, "Use natural Simplified Chinese.");
});

test("Explain accepts only complete aligned English and Chinese output", () => {
  const { normalizeBilingualExplanation } = loadBackgroundHelpers();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        normalizeBilingualExplanation({
          en: "An English explanation.",
          zh: "一段中文解释。",
        }),
      ),
    ),
    {
      explanation: "An English explanation.",
      explanationZh: "一段中文解释。",
    },
  );
  assert.throws(
    () => normalizeBilingualExplanation({ en: "English only." }),
    /incomplete bilingual content/,
  );
});

test("content messaging reinjects once after an extension reload", async () => {
  let sends = 0;
  const injections = [];
  const helpers = loadBackgroundHelpers({
    tabsApi: {
      async sendMessage(tabId, payload) {
        sends += 1;
        assert.equal(tabId, 42);
        assert.deepEqual(payload, { action: "seekTo", seconds: 75 });
        if (sends === 1) {
          throw new Error(
            "Could not establish connection. Receiving end does not exist.",
          );
        }
        return { success: true };
      },
    },
    scriptingApi: {
      async executeScript(details) {
        injections.push(details);
      },
    },
  });

  const result = await helpers.sendToContentWithRecovery(42, {
    action: "seekTo",
    seconds: 75,
  });
  assert.equal(result.success, true);
  assert.equal(sends, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(injections)), [
    { target: { tabId: 42 }, files: ["ui-language.js", "content.js"] },
  ]);
  assert.equal(
    helpers.isMissingContentScriptError(new Error("Permission denied")),
    false,
  );
});

test("side panel setup completes before the user-gesture open path", async () => {
  const calls = [];
  const helpers = loadBackgroundHelpers({
    sidePanelApi: {
      async setOptions(options) {
        calls.push(["setOptions", options]);
      },
      async open(options) {
        calls.push(["open", options]);
      },
    },
  });

  await helpers.prepareSidePanelForTab(42);
  await helpers.openSidePanelForTab(42);

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [
      "setOptions",
      { tabId: 42, path: "sidepanel.html", enabled: true },
    ],
    ["open", { tabId: 42 }],
  ]);
  assert.throws(
    () => helpers.openSidePanelForTab(undefined),
    /could not identify the active browser tab/i,
  );
});

test("Transcript, Overview, Notes, and Explain expose three language modes", () => {
  const html = read("sidepanel.html");
  const js = read("sidepanel.js");
  assert.match(html, /data-transcript-mode="original"[\s\S]*?<span lang="zh-CN">原文<\/span><span lang="en">Original<\/span>/);
  assert.match(html, /data-transcript-mode="zh"[\s\S]*?<span lang="zh-CN">\u4e2d\u6587<\/span><span lang="en">Chinese<\/span>/);
  assert.match(html, /data-transcript-mode="bilingual"[\s\S]*?<span lang="zh-CN">\u53cc\u8bed<\/span><span lang="en">Bilingual<\/span>/);
  assert.match(js, /handleTranscriptModeChange\(button\.dataset\.transcriptMode\)/);
  assert.match(js, /contentType: "transcriptBatch"/);
  assert.doesNotMatch(js, /English \+ Chinese/);
  for (const area of ["overview", "notes"]) {
    assert.match(html, new RegExp(`data-${area}-mode="original"`));
    assert.match(html, new RegExp(`data-${area}-mode="zh"`));
    assert.match(html, new RegExp(`data-${area}-mode="bilingual"`));
    assert.match(js, new RegExp(`handle${area[0].toUpperCase()}${area.slice(1)}ModeChange`));
  }
  assert.match(js, /data-explain-mode="original"[\s\S]*?ui\("英文", "English"\)/);
  assert.match(js, /data-explain-mode="zh"[\s\S]*?ui\("中文", "Chinese"\)/);
  assert.match(js, /data-explain-mode="bilingual"[\s\S]*?ui\("双语", "Bilingual"\)/);
  assert.match(js, /EXPLAIN_LANGUAGE_MODE_KEY = "ytd_explain_language_mode"/);
  assert.match(js, /TRANSCRIPT_LANGUAGE_MODE_KEY = "ytd_transcript_language_mode"/);
  assert.match(js, /let currentTranscriptMode = "bilingual"/);
  assert.match(
    html,
    /class="transcript-mode-btn language-mode-btn active"[\s\S]*?data-transcript-mode="bilingual"[\s\S]*?aria-pressed="true"/,
  );
  assert.match(
    js,
    /chrome\.storage\.local\.set\(\{[\s\S]*?\[TRANSCRIPT_LANGUAGE_MODE_KEY\]: currentTranscriptMode/,
  );
  assert.match(
    js,
    /chrome\.storage\.local\.set\(\{[\s\S]*?\[EXPLAIN_LANGUAGE_MODE_KEY\]: currentExplainMode/,
  );
  assert.match(
    read("prompts/explain.md"),
    /exactly two string fields: `en` and `zh`/,
  );
});

test("localized content renders original, Chinese, and bilingual text safely", () => {
  const {
    getLocalizedPlainText,
    renderLocalizedText,
    normalizeTranscriptLanguageMode,
  } = loadSidepanelHelpers();
  const original = 'Build <script>alert("x")</script> carefully.';
  const chinese = "谨慎地构建。";

  assert.match(renderLocalizedText(original, chinese, "original"), /localized-original/);
  assert.doesNotMatch(renderLocalizedText(original, chinese, "zh"), /Build/);
  const bilingual = renderLocalizedText(original, chinese, "bilingual");
  assert.match(bilingual, /localized-bilingual/);
  assert.match(bilingual, /Build &lt;script&gt;/);
  assert.match(bilingual, /谨慎地构建/);
  assert.equal(getLocalizedPlainText(original, chinese, "zh"), chinese);
  assert.equal(
    getLocalizedPlainText(original, chinese, "bilingual"),
    `${original}\n\n${chinese}`,
  );
  assert.equal(normalizeTranscriptLanguageMode("original"), "original");
  assert.equal(normalizeTranscriptLanguageMode("unsupported"), "bilingual");
});

test("Overview pending translations reuse the anime mascot and 100-message deck", () => {
  const { renderLocalizedText } = loadSidepanelHelpers();
  const pending = renderLocalizedText(
    "A useful quote.",
    "",
    "bilingual",
    "",
    { id: "overview:quote:0:quote", text: "A useful quote." },
  );
  assert.match(pending, /localized-pending/);
  assert.match(pending, /anime-waiting-mascot/);
  assert.match(pending, /anime-waiting-text/);
  assert.doesNotMatch(pending, /Translating/i);

  const panel = read("sidepanel.js");
  assert.match(panel, /overviewFieldId\("chapter", index, "title"\)[\s\S]*?text: chapter\.title/);
  assert.match(panel, /overviewFieldId\("chapter", index, "summary"\)[\s\S]*?text: chapter\.summary/);
  assert.match(panel, /overviewFieldId\("quote", index, "quote"\)[\s\S]*?text: quote\.quote/);
});

test("Explain renders safe English, Chinese, and stacked bilingual content", () => {
  const { normalizeExplainLanguageMode, renderExplanationMarkup } =
    loadSidepanelHelpers();
  const english = 'WorkOS provides <script>alert("x")</script> enterprise tools.';
  const chinese = "WorkOS 提供企业级工具。";

  const original = renderExplanationMarkup(english, chinese, "original");
  assert.match(original, /lang="en"/);
  assert.match(original, /&lt;script&gt;/);
  assert.doesNotMatch(original, /企业级/);

  const translated = renderExplanationMarkup(english, chinese, "zh");
  assert.match(translated, /lang="zh-CN"/);
  assert.match(translated, /企业级/);
  assert.doesNotMatch(translated, /WorkOS provides/);

  const bilingual = renderExplanationMarkup(english, chinese, "bilingual");
  assert.match(bilingual, /explain-text-bilingual/);
  assert.match(bilingual, />English</);
  assert.match(bilingual, />中文</);
  assert.match(bilingual, /WorkOS provides/);
  assert.match(bilingual, /企业级/);
  assert.equal(normalizeExplainLanguageMode("unsupported"), "bilingual");
});

test("playback following calculates a centered and clamped transcript position", () => {
  const { calculateCenteredScrollTop } = loadSidepanelHelpers();

  assert.equal(
    calculateCenteredScrollTop({
      scrollTop: 1000,
      scrollHeight: 5000,
      viewportTop: 200,
      viewportHeight: 800,
      entryTop: 850,
      entryHeight: 100,
    }),
    1300,
  );
  assert.equal(
    calculateCenteredScrollTop({
      scrollTop: 0,
      scrollHeight: 5000,
      viewportTop: 200,
      viewportHeight: 800,
      entryTop: 100,
      entryHeight: 100,
    }),
    0,
  );
  assert.equal(
    calculateCenteredScrollTop({
      scrollTop: 3900,
      scrollHeight: 5000,
      viewportTop: 200,
      viewportHeight: 800,
      entryTop: 1100,
      entryHeight: 200,
    }),
    4200,
  );
});

test("playback following pauses only on explicit user scroll intent", () => {
  const js = read("sidepanel.js");
  const html = read("sidepanel.html");
  assert.match(js, /contentArea\.scrollTo\(\{ top, behavior: "smooth" \}\)/);
  assert.match(js, /scheduleTranscriptCentering\(activeEntry, !alreadyActive\)/);
  assert.match(js, /window\.requestAnimationFrame/);
  assert.match(js, /setPlaybackFocusMode\(true\)/);
  assert.match(js, /setPlaybackFocusMode\(false\)/);
  assert.match(js, /contentArea\.addEventListener\("wheel", onPlaybackWheel/);
  assert.match(js, /contentArea\.addEventListener\("touchmove", onPlaybackTouchMove/);
  assert.match(js, /onPlaybackScrollbarPointerDown/);
  assert.match(js, /document\.addEventListener\("keydown", onPlaybackScrollKey\)/);
  assert.doesNotMatch(js, /addEventListener\("scroll", onContentAreaScroll/);
  assert.match(html, /<span lang="zh-CN">跟随当前字幕<\/span><span lang="en">Follow playback<\/span>/);
});

test("transcript queue prefetches 30 segments in ordered batches of three", async () => {
  const { createTranscriptTranslationQueue } = loadSidepanelHelpers();
  const segments = Array.from({ length: 60 }, (_value, index) => ({
    id: `segment-${index}`,
    text: `Source ${index}`,
  }));
  const batches = [];
  const releases = [];
  const queue = createTranscriptTranslationQueue({
    segments,
    isCached: () => false,
    translateBatch(indices) {
      batches.push([...indices]);
      return new Promise((resolve) => releases.push(resolve));
    },
  });

  queue.prefetchInitial();
  assert.equal(queue.snapshot().pending.length, 30);
  await flushTaskQueue();
  assert.deepEqual(batches, [[0, 1, 2]]);
  assert.equal(queue.snapshot().running, 1);

  releases.shift()();
  await flushTaskQueue();
  assert.deepEqual(batches[1], [3, 4, 5]);
  queue.dispose();
});

test("playback and user navigation bypass background transcript prefetch", async () => {
  const { createTranscriptTranslationQueue } = loadSidepanelHelpers();
  const segments = Array.from({ length: 70 }, (_value, index) => ({
    id: `segment-${index}`,
    text: `Source ${index}`,
  }));
  const batches = [];
  const releases = [];
  const queue = createTranscriptTranslationQueue({
    segments,
    isCached: () => false,
    translateBatch(indices) {
      batches.push([...indices]);
      return new Promise((resolve) => releases.push(resolve));
    },
  });

  queue.prefetchInitial();
  await flushTaskQueue();
  assert.deepEqual(batches, [[0, 1, 2]]);

  queue.prioritizePlayback(45);
  await flushTaskQueue();
  assert.deepEqual(batches[1], [45]);
  assert.equal(queue.snapshot().running, 2);
  queue.dispose();
  releases.splice(0).forEach((resolve) => resolve());

  const navigationBatches = [];
  const navigationReleases = [];
  const navigationQueue = createTranscriptTranslationQueue({
    segments,
    isCached: () => false,
    translateBatch(indices) {
      navigationBatches.push([...indices]);
      return new Promise((resolve) => navigationReleases.push(resolve));
    },
  });

  navigationQueue.prefetchInitial();
  await flushTaskQueue();
  navigationQueue.setRowVisible(52, true);
  navigationQueue.setUserNavigation(true);
  await flushTaskQueue();
  assert.deepEqual(navigationBatches[1], [52]);
  navigationQueue.dispose();
  navigationReleases.splice(0).forEach((resolve) => resolve());
});

test("leaving a non-prefetch row removes its unsent passive translation", () => {
  const { createTranscriptTranslationQueue } = loadSidepanelHelpers();
  const segments = Array.from({ length: 50 }, (_value, index) => ({
    id: `segment-${index}`,
    text: `Source ${index}`,
  }));
  const queue = createTranscriptTranslationQueue({
    segments,
    isCached: () => false,
    translateBatch: () => Promise.resolve(),
  });

  queue.setRowVisible(40, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(queue.snapshot().pending.map((task) => task.index))),
    [40],
  );
  queue.setRowVisible(40, false);
  assert.deepEqual(JSON.parse(JSON.stringify(queue.snapshot().pending)), []);
  queue.dispose();
});

test("semantic segmentation rebuilds sentences across caption boundaries", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const segments = groupTranscriptEntries(
    [
      { start: 0, text: "Caption boundaries should" },
      { start: 2, text: "not break a complete sentence." },
      { start: 5, text: "The next thought also" },
      { start: 7, text: "stays together!" },
    ],
    { minChars: 1, idealChars: 100, maxChars: 320, maxSeconds: 20 },
  );
  assert.equal(segments.length, 2);
  assert.equal(
    segments[0].text,
    "Caption boundaries should not break a complete sentence.",
  );
  assert.equal(segments[0].start, 0);
  assert.equal(segments[1].text, "The next thought also stays together!");
  assert.equal(segments[1].start, 5);
});

test("a huge raw Supadata entry is split into seekable bounded segments", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const text = Array.from({ length: 900 }, (_, index) => `word${index}`).join(" ");
  const segments = groupTranscriptEntries([
    { start: 12, duration: 90, text },
  ]);
  assert.ok(segments.length > 8);
  assert.ok(segments.every((segment) => segment.text.length <= 384));
  assert.equal(segments[0].start, 12);
  assert.ok(segments.at(-1).start > segments[0].start);
  assert.ok(segments.every((segment) => /^segment-\d+-\d+$/.test(segment.id)));
});

test("Chinese sentence and clause punctuation creates semantic guardrails", () => {
  const { groupTranscriptEntries } = loadSidepanelHelpers();
  const segments = groupTranscriptEntries(
    [
      { start: 0, text: "这是一个被字幕切开的" },
      { start: 2, text: "完整句子。这是第二个想法，" },
      { start: 5, text: "也应该保持语义完整！" },
    ],
    { minChars: 1, idealChars: 100, maxChars: 320, maxSeconds: 20 },
  );
  assert.equal(segments.length, 2);
  assert.equal(segments[0].text, "这是一个被字幕切开的完整句子。");
  assert.equal(segments[1].text, "这是第二个想法，也应该保持语义完整！");
});

test("structured translation batches align by stable ID and expose missing fallback", () => {
  const sidepanel = loadSidepanelHelpers();
  const background = loadBackgroundHelpers();
  const source = [
    { id: "segment-0-0", text: "A complete first sentence." },
    { id: "segment-1-5000", text: "A complete second sentence." },
  ];
  assert.deepEqual(
    JSON.parse(JSON.stringify(background.validateTranscriptBatchRequest({ segments: source }))),
    source,
  );

  const normalized = background.normalizeTranslatedSegmentBatch(
    {
      segments: [
        { id: "unknown", text: "\u5ffd\u7565" },
        { id: "segment-1-5000", text: "\u7b2c\u4e8c\u4e2a\u5b8c\u6574\u53e5\u5b50\u3002" },
      ],
    },
    source,
  );
  const aligned = sidepanel.alignTranslatedSegmentBatch(
    source,
    normalized.segments,
  );
  assert.equal(aligned[0].id, source[0].id);
  assert.equal(aligned[0].text, "");
  assert.match(aligned[0].error, /unavailable/i);
  assert.equal(aligned[1].text, "\u7b2c\u4e8c\u4e2a\u5b8c\u6574\u53e5\u5b50\u3002");
});

test("translated-only omits English while bilingual renders aligned English and Chinese", () => {
  const { renderTranscriptSegmentContent } = loadSidepanelHelpers();
  const segment = { id: "segment-0-0", text: "Original English sentence." };
  const translatedOnly = renderTranscriptSegmentContent(
    segment,
    "zh",
    "\u4e2d\u6587\u8bd1\u6587\u3002",
    "",
  );
  const bilingual = renderTranscriptSegmentContent(
    segment,
    "bilingual",
    "\u4e2d\u6587\u8bd1\u6587\u3002",
    "",
  );
  assert.doesNotMatch(translatedOnly, /Original English sentence/);
  assert.match(translatedOnly, /\u4e2d\u6587\u8bd1\u6587/);
  assert.match(bilingual, /transcript-original/);
  assert.match(bilingual, /Original English sentence/);
  assert.match(bilingual, /\u4e2d\u6587\u8bd1\u6587/);
});

test("anime waiting state rotates through 100 unique messages with the mascot", () => {
  const helpers = loadSidepanelHelpers();
  assert.equal(helpers.ANIME_WAITING_MESSAGES.length, 100);
  assert.equal(new Set(helpers.ANIME_WAITING_MESSAGES).size, 100);

  const firstDeck = Array.from({ length: 100 }, (_value, index) =>
    helpers.getAnimeWaitingMessage({
      id: `waiting-${index}`,
      text: `Source ${index}`,
    }),
  );
  assert.equal(new Set(firstDeck).size, 100);

  const pendingHtml = helpers.renderTranscriptSegmentContent(
    { id: "pending-row", text: "Still translating." },
    "bilingual",
    "",
    "",
  );
  assert.match(pendingHtml, /anime-waiting-mascot/);
  assert.match(pendingHtml, /anime-waiting-text/);
  assert.doesNotMatch(pendingHtml, /Waiting for translation/i);

  const explainWaitingHtml = helpers.renderExplainWaitingState({
    id: "explain-pending",
    text: "A difficult phrase",
  });
  assert.match(explainWaitingHtml, /explain-thinking-state/);
  assert.match(explainWaitingHtml, /explain-thinking-avatar/);
  assert.match(explainWaitingHtml, /explain-thinking-text/);
  assert.match(explainWaitingHtml, /explain-thinking-progress/);
  assert.ok(
    helpers.ANIME_WAITING_MESSAGES.some((message) =>
      explainWaitingHtml.includes(message),
    ),
  );
});

test("subtitle formatting tags render in original and translated segment text", () => {
  const { renderTranscriptSegmentContent } = loadSidepanelHelpers();
  const html = renderTranscriptSegmentContent(
    {
      id: "segment-0-0",
      text: "Think <i>deeply</i>, <b>carefully</b>, and <u>clearly</u>.<br>Next line.",
    },
    "bilingual",
    "\u5b57\u5730<i>\u601d\u8003</i>\u7684\u3002<strong>\u91cd\u70b9</strong>",
    "",
  );

  assert.match(html, /Think <i>deeply<\/i>/);
  assert.match(html, /<b>carefully<\/b>/);
  assert.match(html, /<u>clearly<\/u>\.<br>Next line/);
  assert.match(html, /\u5b57\u5730<i>\u601d\u8003<\/i>\u7684\u3002<strong>\u91cd\u70b9<\/strong>/);
});

test("subtitle markup renderer keeps attributed and arbitrary HTML escaped", () => {
  const { renderSubtitleInlineMarkup } = loadSidepanelHelpers();
  const html = renderSubtitleInlineMarkup(
    '<img src=x onerror="alert(1)"><i onclick="alert(2)">unsafe</i><script>alert(3)</script>',
  );

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;i onclick=&quot;alert\(2\)&quot;&gt;unsafe<\/i>/);
  assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img\b|<i\s+onclick|<script\b/);
});

test("background rejects unsupported language fallthrough and malformed batches", () => {
  const source = read("background.js");
  const { validateTranscriptBatchRequest } = loadBackgroundHelpers();
  assert.match(source, /targetLanguage !== "zh"/);
  assert.throws(
    () => validateTranscriptBatchRequest({ segments: [] }),
    /1 to 4 segments/,
  );
  assert.throws(
    () =>
      validateTranscriptBatchRequest({
        segments: [
          { id: "duplicate", text: "first" },
          { id: "duplicate", text: "second" },
        ],
      }),
    /unique and stable/,
  );
});

test("all AI product requests use DeepSeek non-thinking and JSON behavior", async () => {
  const deepSeekRequests = [];
  const successfulFetch = (requests) => async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "translated" } }],
      }),
    };
  };

  const deepSeek = loadBackgroundHelpers({
    fetchImpl: successfulFetch(deepSeekRequests),
  });
  const deepSeekResult = await deepSeek.requestAiCompletion({
    maxTokens: 128,
    responseFormat: { type: "json_object" },
    messages: [{ role: "user", content: "Hello." }],
  });
  assert.equal(deepSeekResult.text, "translated");
  assert.deepEqual(deepSeekRequests[0].thinking, { type: "disabled" });
  assert.deepEqual(deepSeekRequests[0].response_format, {
    type: "json_object",
  });

  const backgroundSource = read("background.js");
  assert.equal(
    (backgroundSource.match(/await requestAiCompletion\(\{/g) || []).length,
    4,
  );
  assert.doesNotMatch(backgroundSource, /disableThinking/);
  for (const callPath of [
    "handleAnalyzeTranscript",
    "cleanupNoteText",
    "handleExplainSelection",
    "callAiTranslation",
  ]) {
    assert.match(
      backgroundSource,
      new RegExp(`async function ${callPath}\\([\\s\\S]*?requestAiCompletion\\(\\{`),
    );
  }
});

test("blank-line chunks reset provider idle timeout and valid JSON succeeds", async () => {
  const timers = createFakeTimers();
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async () =>
      streamingResponse([
        encode("\n"),
        encode("\n"),
        encode('{"choices":[{"message":{"content":"translated"}}]}'),
      ]),
  });

  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, true);
  assert.equal(result.text, "translated");
  assert.equal(timers.createdCount(50_000), 5);
  assert.equal(timers.activeCount(50_000), 0);
  assert.equal(timers.activeCount(120_000), 0);
});

test("provider idle silence aborts with a distinct Retry-able error", async () => {
  const timers = createFakeTimers();
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () =>
            new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        }),
      },
    }),
  });

  const request = helpers.callAiTranslation("Translate.", "Hello.");
  await nextTurn();
  timers.fireActive(50_000);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_IDLE_TIMEOUT");
  assert.match(result.error, /inactive for 50 seconds.*Retry/i);
  assert.equal(timers.activeCount(120_000), 0);
});

test("blank-line keepalives cannot evade the provider hard cap", async () => {
  const timers = createFakeTimers();
  let releaseRead;
  let signal;
  const helpers = loadBackgroundHelpers({
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        body: {
          getReader: () => ({
            read: () =>
              new Promise((resolve, reject) => {
                releaseRead = () => resolve({ done: false, value: encode("\n") });
                signal.addEventListener("abort", () => {
                  const error = new Error("aborted");
                  error.name = "AbortError";
                  reject(error);
                }, { once: true });
              }),
          }),
        },
      };
    },
  });

  const request = helpers.callAiTranslation("Translate.", "Hello.");
  await nextTurn();
  releaseRead();
  await nextTurn();
  releaseRead();
  await nextTurn();
  assert.equal(timers.activeCount(50_000), 1);
  timers.fireActive(120_000);
  const result = await request;
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_HARD_TIMEOUT");
  assert.match(result.error, /120-second limit.*Retry/i);
  assert.equal(timers.activeCount(50_000), 0);
});

test("provider response reader accepts leading whitespace before JSON", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () =>
      streamingResponse([
        encode('  \n\t{"choices":[{"message":{"content":"ok"}}]}'),
      ]),
  });
  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, true);
  assert.equal(result.text, "ok");
});

test("provider response reader rejects bodies over 2 MiB", async () => {
  const helpers = loadBackgroundHelpers({
    fetchImpl: async () =>
      streamingResponse([new Uint8Array(2 * 1024 * 1024 + 1)]),
  });
  const result = await helpers.callAiTranslation("Translate.", "Hello.");
  assert.equal(result.success, false);
  assert.equal(result.code, "AI_RESPONSE_TOO_LARGE");
  assert.match(result.error, /2 MiB limit/);
});

test("DeepSeek retries one empty transcript JSON response without response_format", async () => {
  const requests = [];
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url, options) => {
      if (url.startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/translation.md") };
      }
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: requests.length === 1
                ? ""
                : '{"segments":[{"id":"segment-0-0","text":"\u4e2d\u6587\u8bd1\u6587\u3002"}]}',
            },
          }],
        }),
      };
    },
  });
  const result = await helpers.handleTranslateContent(
    { segments: [{ id: "segment-0-0", text: "English source sentence." }] },
    "transcriptBatch",
    "zh",
    "Video",
  );
  assert.equal(result.success, true);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(Object.hasOwn(requests[1], "response_format"), false);
  assert.equal(requests[0].max_tokens, 1536);
});

test("DeepSeek translates Overview and Notes text with the dedicated prompt", async () => {
  const requests = [];
  const helpers = loadBackgroundHelpers({
    fetchImpl: async (url, options) => {
      if (url.startsWith("chrome-extension://")) {
        return { ok: true, text: async () => read("prompts/translation.md") };
      }
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content:
                '{"segments":[{"id":"overview:chapter:0:title","text":"打造高人才密度团队"}]}',
            },
          }],
        }),
      };
    },
  });

  const result = await helpers.handleTranslateContent(
    {
      segments: [{
        id: "overview:chapter:0:title",
        text: "Building high talent density teams",
      }],
    },
    "uiTextBatch",
    "zh",
    "Talent Density",
  );

  assert.equal(result.success, true);
  assert.equal(result.translatedContent.segments[0].text, "打造高人才密度团队");
  assert.match(requests[0].messages[0].content, /Chapter titles should stay concise/);
});

test("translated notes are persisted with their original note", async () => {
  let savedNotes = [{ id: "note_123", text: "Original note." }];
  const helpers = loadBackgroundHelpers({
    storageLocal: {
      get: async (key) =>
        key === "ytd_notes"
          ? { ytd_notes: savedNotes }
          : { ytd_settings: { provider: "deepseek", aiApiKey: "test-key" } },
      set: async ({ ytd_notes: notes }) => {
        savedNotes = notes;
      },
    },
  });

  const result = await helpers.handleSaveNoteTranslations([
    { noteId: "note_123", text: "中文笔记。" },
  ]);
  assert.equal(result.success, true);
  assert.equal(result.updated, 1);
  assert.equal(savedNotes[0].text, "Original note.");
  assert.equal(savedNotes[0].translations.zh, "中文笔记。");
});

test("note reflections are stored locally without replacing note content", async () => {
  let savedNotes = [{
    id: "note_456",
    text: "Original source note.",
    translations: { zh: "原始笔记。" },
  }];
  const helpers = loadBackgroundHelpers({
    storageLocal: {
      get: async (key) =>
        key === "ytd_notes"
          ? { ytd_notes: savedNotes }
          : { ytd_settings: { provider: "deepseek", aiApiKey: "test-key" } },
      set: async ({ ytd_notes: notes }) => {
        savedNotes = notes;
      },
    },
  });

  const result = await helpers.handleUpdateNoteReflection(
    "note_456",
    "  可以用在下个产品验证中。  ",
  );
  assert.equal(result.success, true);
  assert.equal(result.reflection, "可以用在下个产品验证中。");
  assert.equal(savedNotes[0].text, "Original source note.");
  assert.equal(savedNotes[0].translations.zh, "原始笔记。");
  assert.equal(savedNotes[0].reflection, "可以用在下个产品验证中。");
  assert.match(savedNotes[0].reflectionUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const cleared = await helpers.handleUpdateNoteReflection("note_456", "  ");
  assert.equal(cleared.success, true);
  assert.equal(savedNotes[0].reflection, "");
});

test("note reflection UI keeps source text, actions, and inspiration separate", () => {
  const panel = read("sidepanel.js");
  const styles = read("sidepanel.css");
  assert.match(panel, /class="note-text"/);
  assert.match(panel, /class="note-actions"/);
  assert.match(panel, /class="note-reflection"/);
  assert.match(panel, /action: "updateNoteReflection"/);
  assert.match(panel, /maxlength="3000"/);
  assert.match(panel, /event\.target\.closest\("button, textarea, a"\)/);
  assert.match(panel, /window\.getSelection\(\)\?\.toString\(\)\.trim\(\)/);
  assert.match(styles, /\.note-reflection\s*\{[\s\S]*?border-top:/);
  assert.match(styles, /\.note-reflection-editor\s*\{[\s\S]*?border-left:/);
});

test("translation message watchdog rejects, clears its timer, and ignores late replies", async () => {
  let timeoutCallback;
  let timeoutDelay;
  let resolveMessage;
  let clearCount = 0;
  const helpers = loadSidepanelHelpers({
    sendMessage: () =>
      new Promise((resolve) => {
        resolveMessage = resolve;
      }),
    setTimeoutImpl(callback, delay) {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return 73;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 73);
      clearCount += 1;
    },
  });

  const request = helpers.sendTranslationMessage({
    action: "translateContent",
  });
  assert.equal(timeoutDelay, 130_000);
  timeoutCallback();
  await assert.rejects(request, /timed out after 130 seconds.*Retry/i);
  assert.equal(clearCount, 1);

  resolveMessage({ success: true });
  await Promise.resolve();
  assert.equal(clearCount, 1);

  let successTimeoutCallback;
  let successClearCount = 0;
  const successfulHelpers = loadSidepanelHelpers({
    sendMessage: () => Promise.resolve({ success: true }),
    setTimeoutImpl(callback) {
      successTimeoutCallback = callback;
      return 91;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 91);
      successClearCount += 1;
    },
  });
  assert.deepEqual(
    await successfulHelpers.sendTranslationMessage({
      action: "translateContent",
    }),
    { success: true },
  );
  assert.equal(successClearCount, 1);
  successTimeoutCallback();
  assert.equal(successClearCount, 1);
});

test("Chinese prompt preserves natural bilingual-learning style rules", () => {
  const prompt = read("prompts/translation.md");
  assert.match(prompt, /Translate the complete thought/);
  assert.match(prompt, /Use 你, never 您/);
  assert.match(prompt, /spaces between Chinese and adjacent English words or digits/);
  assert.match(prompt, /source-language `text`/);
});
