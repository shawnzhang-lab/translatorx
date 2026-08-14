const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background.js"), "utf8");

function loadTranscriptHelpers({
  settings = { aiApiKey: "deepseek-test", supadataApiKey: "" },
  pageResult,
  fetchImpl = async () => {
    throw new Error("Unexpected network request");
  },
} = {}) {
  const listeners = { addListener() {} };
  const youtubeTab = {
    id: 7,
    active: true,
    url: "https://www.youtube.com/watch?v=testVideo01",
  };
  const sandbox = {
    console,
    URL,
    fetch: fetchImpl,
    AbortController,
    TextDecoder,
    TextEncoder,
    setTimeout: () => 0,
    clearTimeout() {},
    importScripts() {},
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async () => ({ ytd_settings: settings }),
        },
      },
      action: { onClicked: listeners },
      sidePanel: {
        setPanelBehavior() {},
        setOptions: () => Promise.resolve(),
        open: () => Promise.resolve(),
      },
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        openOptionsPage() {},
        getURL: (file) => `chrome-extension://test/${file}`,
      },
      tabs: {
        onUpdated: listeners,
        onActivated: listeners,
        get: async () => youtubeTab,
        query: async () => [youtubeTab],
        sendMessage: async () => ({}),
      },
      scripting: {
        executeScript: async () => [{ result: pageResult }],
      },
    },
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value || {},
      canonicalYouTubeUrl: (videoId) =>
        `https://www.youtube.com/watch?v=${videoId}`,
      chatCompletionsUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.__YTD_TRANSCRIPT_TESTING__;
}

test("direct YouTube captions avoid Supadata when no fallback key exists", async () => {
  const helpers = loadTranscriptHelpers({
    pageResult: {
      success: true,
      lang: "en",
      content: [
        { text: ">> Hello world", offset: 1250, duration: 2300, lang: "en" },
      ],
    },
  });

  const result = await helpers.handleFetchTranscript("testVideo01", 7);

  assert.equal(result.success, true);
  assert.equal(result.source, "youtube");
  assert.equal(result.transcript[0].text, "Hello world");
  assert.equal(result.transcript[0].start, 1);
  assert.equal(result.transcriptTextTimestamped, "[0:01] Hello world");
});

test("Supadata is called only after direct caption retrieval fails", async () => {
  const requests = [];
  const helpers = loadTranscriptHelpers({
    settings: { aiApiKey: "deepseek-test", supadataApiKey: "fallback-test" },
    pageResult: {
      success: false,
      error: "CAPTION_FETCH_FAILED",
      message: "Direct captions unavailable.",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lang: "en",
          content: [
            { text: "Fallback text", offset: 5000, duration: 1000, lang: "en" },
          ],
        }),
      };
    },
  });

  const result = await helpers.handleFetchTranscript("testVideo01", 7);

  assert.equal(result.success, true);
  assert.equal(result.source, "supadata");
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.hostname, "api.supadata.ai");
  assert.equal(requestUrl.searchParams.get("mode"), "native");
  assert.equal(requests[0].options.headers["x-api-key"], "fallback-test");
});

test("a missing optional fallback key does not hide the direct error", async () => {
  const helpers = loadTranscriptHelpers({
    pageResult: {
      success: false,
      error: "NO_TRANSCRIPT",
      message: "No manual or automatic captions.",
    },
  });

  const result = await helpers.handleFetchTranscript("testVideo01", 7);

  assert.equal(result.success, false);
  assert.equal(result.error, "NO_TRANSCRIPT");
  assert.equal(result.message, "No manual or automatic captions.");
});
