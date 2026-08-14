/**
 * SIDE PANEL LOGIC
 *
 * Handles the UI for TranslatorX: video detection, transcript analysis,
 * rendering results, and export features.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// STATE
// ============================================================

let currentVideoId = null;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTranscriptText = null; // Plain text (for display/export)
let currentTranscriptTimestamped = null; // With timestamps for AI analysis
let currentTranscriptLanguage = null;
let currentTranscriptSource = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let isAnalysisLoading = false; // Track if analysis is in progress
let youtubeTabId = null; // Store the YouTube tab ID for reliable messaging
let errorAction = null;
let currentErrorView = null;
let uiLanguage = "zh-CN";

// --- Translation state ---
// The public transcript control intentionally supports only the original
// subtitles, Chinese, and an aligned source + Chinese view.
let currentTranscriptMode = "bilingual";
let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
let translationWorkCount = 0;
let transcriptScrollObserver = null;
// Stable keys include the video, source mode, language, and semantic segment ID.
let transcriptParagraphCache = new Map();
let animeWaitingMessageCache = new Map();
let animeWaitingMessageDeck = [];
let lastAnimeWaitingMessageIndex = -1;
const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;
const TRANSCRIPT_INITIAL_PREFETCH_COUNT = 30;
const TRANSCRIPT_TRANSLATION_BATCH_SIZE = 3;
const TRANSCRIPT_PRIORITY_INITIAL = 100;
const TRANSCRIPT_PRIORITY_PASSIVE_VISIBLE = 150;
const TRANSCRIPT_PRIORITY_USER_VISIBLE = 300;
const TRANSCRIPT_PRIORITY_PLAYBACK = 400;
const TRANSCRIPT_PRIORITY_RETRY = 500;

// Overview and Notes use the same three display modes as Transcript. Overview
// translations live inside the per-video digest cache; note translations are
// persisted with each saved note.
let currentOverviewMode = "original";
let overviewTranslationGeneration = 0;
let overviewTranslationErrors = new Map();
let currentNotesMode = "original";
let currentNotes = [];
let currentNotesFilterVideoId = null;
let notesTranslationGeneration = 0;
let notesTranslationObserver = null;
let notesTranslationErrors = new Map();
const EXPLAIN_LANGUAGE_MODE_KEY = "ytd_explain_language_mode";
const TRANSCRIPT_LANGUAGE_MODE_KEY = "ytd_transcript_language_mode";
let currentExplainMode = "bilingual";

/**
 * Prevent a stopped service worker or dead message channel from leaving the
 * transcript queue stuck forever. The underlying Chrome message cannot be
 * cancelled, so settled guards deliberately ignore any late response.
 */
function sendTranslationMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    timeoutId = setTimeout(() => {
      finish(
        reject,
        new Error(
          "Translation request timed out after 130 seconds. Please Retry.",
        ),
      );
    }, TRANSLATION_MESSAGE_TIMEOUT_MS);

    let messagePromise;
    try {
      messagePromise = chrome.runtime.sendMessage(message);
    } catch (error) {
      finish(reject, error);
      return;
    }

    Promise.resolve(messagePromise).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

// --- Auto-scroll state (follow video playback in transcript) ---
let autoScrollEnabled = true; // True = scroll transcript to follow video playback
let autoScrollInterval = null; // setInterval ID for polling video time
let playbackTouchStartY = null;
let playbackCenterFrame = null;
const PLAYBACK_CENTER_TOLERANCE_PX = 18;
const PLAYBACK_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

// ============================================================
// TRANSCRIPT GROUPING
// ============================================================

const TRANSCRIPT_SEGMENT_LIMITS = Object.freeze({
  minChars: 60,
  idealChars: 180,
  maxChars: 320,
  maxSeconds: 20,
});

function normalizeCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

/**
 * Splits a single oversized thought at the strongest nearby punctuation.
 * Word boundaries are the final safety valve for captions with no punctuation.
 */
function splitOversizedThought(text, maxChars) {
  const parts = [];
  let rest = normalizeCaptionText(text);

  while (rest.length > maxChars) {
    const windowText = rest.slice(0, maxChars + 1);
    const lowerBound = Math.floor(maxChars * 0.55);
    let cut = -1;

    for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(windowText))) {
        if (match.index >= lowerBound) cut = match.index + match[0].length;
      }
      if (cut > 0) break;
    }

    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Reconstructs complete sentences across raw caption boundaries. Each segment
 * keeps the timestamp of the first caption that contributed text. Character
 * and time limits prevent a malformed Supadata entry from becoming one giant
 * row while punctuation remains the preferred boundary.
 */
function groupTranscriptEntries(entries, limits = TRANSCRIPT_SEGMENT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const pieces = [];
  entries.forEach((entry, entryIndex) => {
    const text = normalizeCaptionText(entry?.text);
    if (!text) return;
    const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
    const duration = Math.max(0, Number(entry.duration) || 0);
    const sentenceParts =
      text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) ||
      [text];
    let consumedChars = 0;

    sentenceParts.forEach((sentencePart) => {
      const cleanPart = normalizeCaptionText(sentencePart);
      if (!cleanPart) return;
      const oversizedParts = splitOversizedThought(cleanPart, limits.maxChars);
      oversizedParts.forEach((part, partIndex) => {
        const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
        pieces.push({
          text: part,
          start: start + duration * ratio,
          semanticEnd:
            /[.!?。！？]["')\]”’）】」』]*$/.test(part) ||
            oversizedParts.length > 1,
          clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
          sourceOrder: `${entryIndex}:${partIndex}`,
        });
        consumedChars += part.length + 1;
      });
    });
  });

  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) return;
    const index = grouped.length;
    const text = normalizeCaptionText(current.text);
    grouped.push({
      id: `segment-${index}-${Math.round(current.start * 1000)}`,
      start: current.start,
      text,
      texts: [text],
    });
    current = null;
  };

  pieces.forEach((piece) => {
    if (!current) current = { start: piece.start, text: "" };
    current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
    const elapsed = Math.max(0, piece.start - current.start);
    const comfortablySized = current.text.length >= limits.minChars;
    const reachedIdeal = current.text.length >= limits.idealChars;
    const atNaturalBoundary =
      piece.semanticEnd ||
      (piece.clauseEnd &&
        (reachedIdeal ||
          current.text.length >= limits.maxChars ||
          elapsed >= limits.maxSeconds));
    const reachedGuardrail =
      atNaturalBoundary &&
      (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
    const reachedHardGuardrail =
      current.text.length >= Math.round(limits.maxChars * 1.2) ||
      elapsed >= limits.maxSeconds + 5;

    if (
      (atNaturalBoundary && (comfortablySized || elapsed >= 8)) ||
      (atNaturalBoundary && reachedIdeal) ||
      reachedGuardrail ||
      reachedHardGuardrail
    ) {
      flush();
    }
  });
  flush();

  return grouped;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const uiController = await TX_UI_LANGUAGE.setupToggle({
    button: document.getElementById("uiLanguageToggle"),
    onChange(language) {
      uiLanguage = language;
      refreshInterfaceLanguage();
    },
  });
  uiLanguage = uiController.language;
  await restoreTranscriptLanguageMode();
  await restoreExplainLanguageMode();
  setupEventListeners();
  await evictOldCacheEntries(20);

  const configStatus = await chrome.runtime.sendMessage({
    action: "checkConfig",
  });

  if (!configStatus.hasAiKey) {
    showConfigError(configStatus);
    return;
  }

  await checkCurrentTab();
});

function ui(chinese, english) {
  return TX_UI_LANGUAGE.pick(uiLanguage, chinese, english);
}

function refreshInterfaceLanguage() {
  if (currentErrorView?.type === "config") {
    showConfigError(currentErrorView.status);
  } else if (currentErrorView?.type === "general") {
    showError(currentErrorView.title, currentErrorView.message);
  }
  if (currentTranscript) {
    if (currentTranscriptMode === "original") renderTranscript();
    else renderTranscriptModeRows(getActiveTranscriptSegments(), currentTranscriptMode);
  }
  if (currentAnalysis) renderAnalysisResults(currentAnalysis);
  if (currentNotes.length || currentNotesFilterVideoId !== null) {
    renderNotes(currentNotes, currentNotesFilterVideoId);
  }
  const explainButton = document.querySelector("#explainTooltip .explain-btn");
  if (explainButton) explainButton.textContent = ui("💡 解释", "💡 Explain");
  // Closing an open explanation keeps one modal from mixing labels in two
  // languages. The selected text remains available for a fresh request.
  document.getElementById("explainModal")?.remove();
}

// Listen for messages from the Digest button on YouTube page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDigestFromButton") {
    // Load the digest for the current video. Served from cache when we've
    // seen this video before (no API calls); fetched fresh otherwise.
    // (This used to force-clear the cache on every click, which silently
    // burned a transcript credit + analysis tokens per click.)
    checkCurrentTab();
    sendResponse({ success: true });
  }
  if (message.action === "transcriptProgress") {
    // Background is telling us the transcript fetch status changed
    updateLoading(message.title, message.subtitle);
    sendResponse({ success: true });
  }
  if (message.action === "noteSaved") {
    // Refresh notes list when a new note is saved
    const filterAll = document
      .getElementById("notesFilterAll")
      ?.classList.contains("active");
    loadNotes(filterAll ? null : currentVideoId);
    sendResponse({ success: true });
  }
  return false;
});

// ============================================================
// FOLLOW THE ACTIVE TAB
// ============================================================
// The panel watches which tab is in front of it and reacts:
//   - Front tab is NOT YouTube  -> the panel closes itself (window.close()).
//     We do this OURSELVES rather than relying only on the background
//     script's per-tab enable/disable, because Chrome doesn't reliably
//     apply per-tab panel state to tabs spawned in unusual ways (e.g. a
//     link opened from another app) — which let the panel linger on
//     non-YouTube pages.
//   - Front tab IS YouTube but on a different video -> refresh the digest.
//     YouTube is a single-page app (clicking a video swaps content without
//     a reload), so we track URL changes; startDigest() caches per video,
//     making re-checks instant and free for already-digested videos.
//
// Everything is scoped to the window this panel lives in: tab switches in
// OTHER browser windows must not close this panel or hijack its content.

let navigationRefreshTimer = null;
let panelWindowId = null;
chrome.windows.getCurrent().then((w) => {
  panelWindowId = w.id;
});

function scheduleDigestRefresh() {
  // Small delay lets YouTube finish rendering the new video's title and
  // description before we read them. Also collapses rapid-fire URL events
  // into a single refresh.
  clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = setTimeout(() => {
    checkCurrentTab();
  }, 600);
}

function panelIsShowingResults() {
  const results = document.getElementById("resultsState");
  return results && results.style.display !== "none";
}

/**
 * Reacts to the URL now in front of the panel: close on non-YouTube,
 * refresh the digest when the video changed.
 */
function handleFrontTabUrl(url) {
  if (!(url || "").startsWith("https://www.youtube.com")) {
    // Panel is a YouTube-only tool — remove itself from non-YouTube tabs.
    window.close();
    return;
  }

  const newVideoId = extractVideoId(url);
  // Refresh when the video changed, or when we're not currently showing
  // results (e.g. user went home, then clicked back into the same video).
  if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
    scheduleDigestRefresh();
  }
}

// Fires when a tab's URL changes — including YouTube's no-reload navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.active) return;
  if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
  handleFrontTabUrl(changeInfo.url);
});

// Fires when a different tab comes to the front — switching tabs, or a new
// tab being opened (including ones opened by clicking links in other apps).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (panelWindowId !== null && windowId !== panelWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Brand-new tabs may not have committed their URL yet — fall back to
    // the pending one so we judge where the tab is actually going.
    handleFrontTabUrl(tab.url || tab.pendingUrl || "");
  } catch (e) {
    // Tab closed before we could read it — nothing to do.
  }
});

function setupEventListeners() {
  // A Chrome side panel is its own document, so a key pressed while the panel
  // has focus never reaches the YouTube content script. Forward plain N to the
  // current video's page; that page owns timestamp capture and save feedback.
  document.addEventListener("keydown", handlePanelNoteKeyboardShortcut, true);

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Error retry
  document.getElementById("errorBtn").addEventListener("click", () => {
    if (errorAction) {
      errorAction();
      return;
    }
    if (currentVideoId) {
      startDigest(currentVideoId, currentVideoUrl);
    }
  });

  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptions" });
  });

  // Transcript actions
  document
    .getElementById("copyTranscriptBtn")
    ?.addEventListener("click", copyTranscript);
  document
    .getElementById("exportTranscriptBtn")
    ?.addEventListener("click", exportTranscript);
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleTranscriptModeChange(button.dataset.transcriptMode);
    });
  });
  document.querySelectorAll(".overview-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleOverviewModeChange(button.dataset.overviewMode);
    });
  });
  document.querySelectorAll(".notes-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleNotesModeChange(button.dataset.notesMode);
    });
  });

  // Follow playback button — re-enables auto-scroll after user scrolled away
  document
    .getElementById("followPlaybackBtn")
    ?.addEventListener("click", () => {
      autoScrollEnabled = true;
      activeTranslationQueue?.setUserNavigation(false);
      setPlaybackFocusMode(true);
      document.getElementById("followPlaybackBtn").style.display = "none";
      if (!scrollToActiveEntry()) {
        playbackTrackingTick(); // No highlight yet — let a tick establish one
      }
    });

  // Notes filter buttons
  document.getElementById("notesFilterThis")?.addEventListener("click", () => {
    setNotesFilter(false);
    loadNotes(currentVideoId);
  });
  document.getElementById("notesFilterAll")?.addEventListener("click", () => {
    setNotesFilter(true);
    loadNotes(null); // Load all notes
  });
}

function setNotesFilter(showAll) {
  const thisVideoButton = document.getElementById("notesFilterThis");
  const allNotesButton = document.getElementById("notesFilterAll");
  thisVideoButton?.classList.toggle("active", !showAll);
  thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
  allNotesButton?.classList.toggle("active", showAll);
  allNotesButton?.setAttribute("aria-pressed", String(showAll));
}

// ============================================================
// VIDEO DETECTION
// ============================================================

async function checkCurrentTab() {
  try {
    // Try multiple strategies to find the YouTube tab
    let tab = null;

    // Strategy 1: Active tab in last focused window
    let tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tabs[0]?.url?.includes("youtube.com")) {
      tab = tabs[0];
    }

    // Strategy 2: Any active YouTube tab
    if (!tab) {
      tabs = await chrome.tabs.query({
        url: "https://www.youtube.com/*",
        active: true,
      });
      if (tabs[0]) tab = tabs[0];
    }

    // Strategy 3: Any YouTube tab (last resort)
    if (!tab) {
      tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
      if (tabs[0]) tab = tabs[0];
    }

    debugLog("[TranslatorX Panel] Found tab:", tab?.id, tab?.url);

    if (!tab?.url) {
      showState("welcome");
      return;
    }

    // Store the tab ID for reliable messaging later
    youtubeTabId = tab.id;

    const videoId = extractVideoId(tab.url);

    if (videoId) {
      currentVideoUrl = tab.url;

      try {
        // Route through background script for reliable message passing
        const result = await chrome.runtime.sendMessage({
          action: "relayToContent",
          payload: { action: "getVideoInfo" },
        });
        debugLog("[TranslatorX Panel] getVideoInfo result:", result);
        if (result.success && result.response) {
          currentVideoTitle = result.response.title || "";
          currentChannelName = result.response.channelName || "";
          currentVideoDescription = result.response.description || "";
          currentVideoDuration = result.response.duration || 0;
        }
      } catch (e) {
        console.error("[TranslatorX Panel] getVideoInfo error:", e);
        currentVideoTitle = "";
        currentChannelName = "";
        currentVideoDescription = "";
        currentVideoDuration = 0;
      }

      startDigest(videoId, tab.url);
    } else {
      showState("welcome");
    }
  } catch (error) {
    console.error("Tab check error:", error);
    showState("welcome");
  }
}

function extractVideoId(url) {
  try {
    const urlObj = new URL(url);

    if (
      urlObj.hostname.includes("youtube.com") &&
      urlObj.searchParams.has("v")
    ) {
      return urlObj.searchParams.get("v");
    }

    if (urlObj.hostname === "youtu.be") {
      return urlObj.pathname.slice(1);
    }

    if (urlObj.pathname.startsWith("/embed/")) {
      return urlObj.pathname.split("/")[2];
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// DIGEST PIPELINE
// ============================================================

async function startDigest(videoId, videoUrl) {
  // Check if we already have this video loaded in memory
  if (videoId === currentVideoId && currentAnalysis) {
    showState("results");
    return;
  }

  // Every video change invalidates observer work and in-flight translations.
  if (videoId !== currentVideoId) {
    activeTranslationQueue?.dispose();
    activeTranslationQueue = null;
    translationGeneration += 1;
    overviewTranslationGeneration += 1;
    notesTranslationGeneration += 1;
    overviewTranslationErrors = new Map();
    notesTranslationErrors = new Map();
    resetAnimeWaitingMessages();
    if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
    transcriptScrollObserver = null;
    if (notesTranslationObserver) notesTranslationObserver.disconnect();
    notesTranslationObserver = null;
  }

  // Check cache for this video
  const cached = await loadFromCache(videoId);
  if (cached) {
    debugLog("Loading from cache:", videoId);
    currentVideoId = videoId;
    currentVideoUrl = videoUrl;
    currentAnalysis = cached.analysis || null;
    currentTranscript = cached.transcript;
    currentTranscriptText = cached.transcriptText;
    currentTranscriptTimestamped = cached.transcriptTimestamped;
    currentTranscriptLanguage = cached.transcriptLanguage || null;
    currentTranscriptSource = cached.transcriptSource || null;
    isAnalysisLoading = false;

    // Restore semantic-segment translations from persistent storage.
    if (cached.paragraphCache) {
      for (const [key, value] of Object.entries(cached.paragraphCache)) {
        transcriptParagraphCache.set(key, value);
      }
    }

    if (currentVideoTitle || currentChannelName) {
      const videoInfo = document.getElementById("videoInfo");
      document.getElementById("videoTitle").textContent = currentVideoTitle;
      document.getElementById("videoChannel").textContent = currentChannelName;
      videoInfo.style.display = "block";
    }

    // Always render transcript first
    renderTranscript();

    // Render analysis if we have it cached
    if (currentAnalysis) {
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);
      if (currentOverviewMode !== "original") translateOverview();
    }

    showState("results");
    document.getElementById("tabsNav").style.display = "flex";

    // Load notes for this video
    loadNotes(videoId);

    // Setup explain feature
    setupExplainFeature();
    if (currentTranscriptMode !== "original") translateTranscript();
    return;
  }

  currentVideoId = videoId;
  currentVideoUrl = videoUrl;
  currentAnalysis = null;
  currentTranscript = null;
  currentTranscriptText = null;
  currentTranscriptTimestamped = null;
  currentTranscriptLanguage = null;
  currentTranscriptSource = null;
  isAnalysisLoading = false;

  if (currentVideoTitle || currentChannelName) {
    const videoInfo = document.getElementById("videoInfo");
    document.getElementById("videoTitle").textContent = currentVideoTitle;
    document.getElementById("videoChannel").textContent = currentChannelName;
    videoInfo.style.display = "block";
  }

  showState("loading");
  updateLoading(ui("正在获取字幕", "Fetching transcript"), "");

  const transcriptResult = await chrome.runtime.sendMessage({
    action: "fetchTranscript",
    videoId: videoId,
    tabId: youtubeTabId,
  });

  if (!transcriptResult.success) {
    showError(
      ui("未找到字幕", "No transcript found"),
      transcriptResult.message || transcriptResult.error,
    );
    return;
  }

  currentTranscript = transcriptResult.transcript;
  currentTranscriptText = transcriptResult.transcriptText;
  currentTranscriptTimestamped = transcriptResult.transcriptTextTimestamped;
  currentTranscriptLanguage = transcriptResult.language || null;
  currentTranscriptSource = transcriptResult.source || null;

  // Render transcript immediately (no LLM needed)
  renderTranscript();
  showState("results");
  document.getElementById("tabsNav").style.display = "flex";

  // Load notes for this video
  loadNotes(videoId);

  // Setup explain feature for text selection
  setupExplainFeature();
  if (currentTranscriptMode !== "original") translateTranscript();

  // Save transcript to cache (without analysis)
  await saveToCache(videoId);

  // DON'T run LLM analysis automatically - wait for user to click Overview tab
  // This saves tokens when user just wants to see the transcript
}

// ============================================================
// RENDERING
// ============================================================

const LANGUAGE_MODES = Object.freeze(["original", "zh", "bilingual"]);

const ANIME_WAITING_MESSAGES = Object.freeze([
  "嚼嚼嚼，进食中···",
  "啊，好困，不想翻译···",
  "45°仰望天空中···",
  "翻译魔法蓄力中···",
  "字幕精灵正在集合···",
  "稍等，语言齿轮转动中···",
  "抱紧词典冲刺中···",
  "让我先发呆三秒···",
  "咕噜咕噜煮句子中···",
  "灵感正在穿鞋···",
  "翻译姬刚刚起床···",
  "小脑袋高速运转中···",
  "正在捕捉逃跑的单词···",
  "句子排队过传送门中···",
  "标点符号开会中···",
  "正在给语气加糖···",
  "偷偷向词典求救中···",
  "魔法阵画歪了，重来中···",
  "语言精灵加载中···",
  "等一下下，马上就好···",
  "正在把英文揉成中文···",
  "单词们正在换衣服···",
  "让我喝口奶茶再继续···",
  "脑内字幕施工中···",
  "正在召唤翻译使魔···",
  "啾啾啾，信号搜索中···",
  "灵感掉到桌子下面了···",
  "正在认真地装作认真···",
  "句意正在慢慢发芽···",
  "翻译进度偷偷前进中···",
  "词语拼图进行中···",
  "正在给句子梳头发···",
  "语法猫猫踩键盘中···",
  "等待语言星星降落···",
  "翻译姬伸懒腰中···",
  "这句话有点害羞···",
  "正在哄单词乖乖排队···",
  "脑容量扩展中，请稍候···",
  "让我和标点谈谈心···",
  "正在熬一锅中文汤···",
  "字幕正在穿越次元壁···",
  "翻译魔杖暂时卡顿中···",
  "小精灵正在搬运文字···",
  "句子正在做热身运动···",
  "嘘，灵感正在睡觉···",
  "正在把语气轻轻接住···",
  "词典翻页声沙沙沙···",
  "翻译姬正在补充糖分···",
  "正在给长句拆快递···",
  "等我把主语找回来···",
  "宾语好像迷路了···",
  "谓语正在赶来的路上···",
  "正在和时态斗智斗勇···",
  "语言频道连接中···",
  "字幕星球发来讯号···",
  "翻译结界展开中···",
  "正在清点每一只单词···",
  "让我先眨眨眼睛···",
  "灵感电量只剩一格···",
  "正在给翻译充电···",
  "咔哒咔哒，齿轮工作中···",
  "句子正在排练中文版···",
  "翻译姬进入专注模式···",
  "不许催，正在变魔法···",
  "马上好，再等半块饼干···",
  "正在把意思捞出来···",
  "语境海洋潜水中···",
  "单词太多，先数一遍···",
  "翻译小队迷你会议中···",
  "正在挑选最顺口的说法···",
  "让我把这句捧稳一点···",
  "句尾还在慢悠悠赶路···",
  "正在擦亮中文表达···",
  "字幕泡泡生成中···",
  "灵感云朵飘过来了···",
  "正在捕捉正确语气···",
  "翻译姬偷偷打了个哈欠···",
  "小小延迟，大大努力···",
  "句子正在换乘中文列车···",
  "正在为单词安排座位···",
  "翻译魔法读条中···",
  "请给脑细胞一点时间···",
  "正在拼装自然的中文···",
  "词义迷宫探险中···",
  "翻译姬原地思考中···",
  "正在和双关语谈判···",
  "这句有点难，让我抱抱···",
  "语气包裹配送中···",
  "正在把字幕变得软乎乎···",
  "语言雷达扫描中···",
  "让我再确认亿遍···",
  "翻译精灵正在抄作业···",
  "咕咕咕，句子孵化中···",
  "正在寻找隐藏的上下文···",
  "文字炼金术进行中···",
  "翻译姬努力不掉线···",
  "最后一颗单词归位中···",
  "中文版本即将登场···",
  "马上完成，先不要眨眼···",
  "锵锵，答案准备出现···",
]);

function resetAnimeWaitingMessages() {
  animeWaitingMessageCache = new Map();
  animeWaitingMessageDeck = [];
  lastAnimeWaitingMessageIndex = -1;
}

function isEditableShortcutTarget(target) {
  return Boolean(
    target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable ||
        target.closest?.('[contenteditable="true"], [role="textbox"]')),
  );
}

async function forwardNoteShortcutToYouTube() {
  const payload = { action: "saveCurrentNote" };

  if (Number.isInteger(youtubeTabId)) {
    try {
      return await chrome.tabs.sendMessage(youtubeTabId, payload);
    } catch (error) {
      debugLog(
        "[TranslatorX Panel] Direct note shortcut failed, using relay:",
        error?.message,
      );
    }
  }

  const relayed = await chrome.runtime.sendMessage({
    action: "relayToContent",
    payload,
  });
  return relayed?.response || {
    success: false,
    error: relayed?.error || "Could not reach the YouTube video",
  };
}

function handlePanelNoteKeyboardShortcut(event) {
  if (event.key !== "n" && event.key !== "N") return;
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!currentVideoId || isEditableShortcutTarget(event.target)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  forwardNoteShortcutToYouTube().catch((error) => {
    console.error("[TranslatorX Panel] Note shortcut error:", error);
  });
}

function refillAnimeWaitingMessageDeck() {
  const deck = ANIME_WAITING_MESSAGES.map((_message, index) => index);
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }
  if (
    deck.length > 1 &&
    deck[deck.length - 1] === lastAnimeWaitingMessageIndex
  ) {
    [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
  }
  animeWaitingMessageDeck = deck;
}

function getAnimeWaitingMessage(segment, refresh = false) {
  const key = `${currentVideoId || "video"}:${segment?.id || segment?.text || "pending"}`;
  const previous = animeWaitingMessageCache.get(key);
  if (!refresh && previous) return previous;
  if (!animeWaitingMessageDeck.length) refillAnimeWaitingMessageDeck();

  let messageIndex = animeWaitingMessageDeck.pop();
  if (
    refresh &&
    ANIME_WAITING_MESSAGES[messageIndex] === previous &&
    animeWaitingMessageDeck.length
  ) {
    const replacementIndex = animeWaitingMessageDeck.pop();
    animeWaitingMessageDeck.unshift(messageIndex);
    messageIndex = replacementIndex;
  }
  lastAnimeWaitingMessageIndex = messageIndex;
  const message = ANIME_WAITING_MESSAGES[messageIndex];
  animeWaitingMessageCache.set(key, message);
  return message;
}

function renderAnimeWaitingState(segment, refresh = false) {
  const message = getAnimeWaitingMessage(segment, refresh);
  return `<span class="anime-waiting"><span class="anime-waiting-mascot" aria-hidden="true"></span><span class="anime-waiting-text">${escapeHtml(message)}</span></span>`;
}

function renderExplainWaitingState(segment, refresh = false) {
  const message = getAnimeWaitingMessage(segment, refresh);
  return `
    <div class="explain-thinking-state" role="status" aria-live="polite">
      <div class="explain-thinking-stage" aria-hidden="true">
        <span class="explain-thinking-avatar"></span>
        <span class="explain-thinking-bubble explain-thinking-bubble--one"></span>
        <span class="explain-thinking-bubble explain-thinking-bubble--two"></span>
      </div>
      <span class="explain-thinking-text">${escapeHtml(message)}</span>
      <span class="explain-thinking-progress" aria-hidden="true"></span>
    </div>
  `;
}

function getLocalizedPlainText(original, translated, mode) {
  const source = String(original || "").trim();
  const chinese = String(translated || "").trim();
  if (mode === "zh") return chinese || source;
  if (mode === "bilingual" && chinese) return `${source}\n\n${chinese}`;
  return source;
}

function renderLocalizedText(
  original,
  translated,
  mode,
  error = "",
  waitingSegment = null,
) {
  const source = String(original || "").trim();
  if (!source) return "";
  const chinese = String(translated || "").trim();
  const translatedClass = chinese
    ? "localized-translation"
    : error
      ? "localized-translation localized-error"
      : "localized-translation localized-pending";
  const translatedHtml = chinese
    ? escapeHtml(chinese)
    : error
      ? escapeHtml(error)
      : waitingSegment
        ? renderAnimeWaitingState(waitingSegment)
        : escapeHtml("Translating…");

  if (mode === "zh") {
    return `<span class="${translatedClass}">${translatedHtml}</span>`;
  }
  if (mode === "bilingual") {
    return `<span class="localized-bilingual"><span class="localized-original">${escapeHtml(source)}</span><span class="${translatedClass}">${translatedHtml}</span></span>`;
  }
  return `<span class="localized-original">${escapeHtml(source)}</span>`;
}

function setLanguageModeButtons(selector, dataKey, mode) {
  document.querySelectorAll(selector).forEach((button) => {
    const active = button.dataset[dataKey] === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setLanguageSpinner(id, visible) {
  document.getElementById(id)?.classList.toggle("visible", visible);
}

function normalizeExplainLanguageMode(mode) {
  return LANGUAGE_MODES.includes(mode) ? mode : "bilingual";
}

function normalizeTranscriptLanguageMode(mode) {
  return LANGUAGE_MODES.includes(mode) ? mode : "bilingual";
}

async function restoreTranscriptLanguageMode() {
  try {
    const stored = await chrome.storage.local.get(TRANSCRIPT_LANGUAGE_MODE_KEY);
    currentTranscriptMode = normalizeTranscriptLanguageMode(
      stored[TRANSCRIPT_LANGUAGE_MODE_KEY],
    );
  } catch (error) {
    console.warn("Could not restore the transcript language preference:", error);
    currentTranscriptMode = "bilingual";
  }
  setTranscriptModeButtons(currentTranscriptMode);
}

async function saveTranscriptLanguageMode(mode) {
  currentTranscriptMode = normalizeTranscriptLanguageMode(mode);
  try {
    await chrome.storage.local.set({
      [TRANSCRIPT_LANGUAGE_MODE_KEY]: currentTranscriptMode,
    });
  } catch (error) {
    console.warn("Could not save the transcript language preference:", error);
  }
}

async function restoreExplainLanguageMode() {
  try {
    const stored = await chrome.storage.local.get(EXPLAIN_LANGUAGE_MODE_KEY);
    currentExplainMode = normalizeExplainLanguageMode(
      stored[EXPLAIN_LANGUAGE_MODE_KEY],
    );
  } catch (error) {
    console.warn("Could not restore the Explain language preference:", error);
    currentExplainMode = "bilingual";
  }
}

async function saveExplainLanguageMode(mode) {
  currentExplainMode = normalizeExplainLanguageMode(mode);
  try {
    await chrome.storage.local.set({
      [EXPLAIN_LANGUAGE_MODE_KEY]: currentExplainMode,
    });
  } catch (error) {
    console.warn("Could not save the Explain language preference:", error);
  }
}

function formatExplanationParagraphs(text) {
  return String(text || "")
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function renderExplanationMarkup(explanation, explanationZh, mode) {
  const activeMode = normalizeExplainLanguageMode(mode);
  const english = formatExplanationParagraphs(explanation);
  const chinese = formatExplanationParagraphs(explanationZh);

  if (activeMode === "original") {
    return `<div class="explain-text" lang="en">${english}</div>`;
  }
  if (activeMode === "zh") {
    return `<div class="explain-text" lang="zh-CN">${chinese}</div>`;
  }
  return `<div class="explain-text explain-text-bilingual"><section class="explain-language-block" lang="en"><div class="explain-language-label">English</div>${english}</section><section class="explain-language-block" lang="zh-CN"><div class="explain-language-label">中文</div>${chinese}</section></div>`;
}

function overviewFieldId(type, index, field) {
  return `overview:${type}:${index}:${field}`;
}

function getPendingOverviewTranslationItems(analysis) {
  const items = [];
  (analysis?.chapters || []).forEach((chapter, index) => {
    if (chapter.title && !chapter.titleZh) {
      items.push({
        id: overviewFieldId("chapter", index, "title"),
        text: chapter.title,
        apply: (text) => {
          chapter.titleZh = text;
        },
      });
    }
    if (chapter.summary && !chapter.summaryZh) {
      items.push({
        id: overviewFieldId("chapter", index, "summary"),
        text: chapter.summary,
        apply: (text) => {
          chapter.summaryZh = text;
        },
      });
    }
  });
  (analysis?.keyQuotes || []).forEach((quote, index) => {
    if (quote.quote && !quote.quoteZh) {
      items.push({
        id: overviewFieldId("quote", index, "quote"),
        text: quote.quote,
        apply: (text) => {
          quote.quoteZh = text;
        },
      });
    }
  });
  return items;
}

async function handleOverviewModeChange(mode) {
  if (!LANGUAGE_MODES.includes(mode)) return;
  currentOverviewMode = mode;
  overviewTranslationGeneration += 1;
  setLanguageSpinner("overviewLangSpinner", false);
  setLanguageModeButtons(".overview-mode-btn", "overviewMode", mode);
  if (currentAnalysis) renderAnalysisResults(currentAnalysis);
  if (mode !== "original") await translateOverview();
}

async function translateOverview() {
  if (!currentAnalysis || currentOverviewMode === "original") return;
  const analysis = currentAnalysis;
  const videoId = currentVideoId;
  const pending = getPendingOverviewTranslationItems(analysis);
  if (!pending.length) {
    renderAnalysisResults(analysis);
    return;
  }

  const generation = ++overviewTranslationGeneration;
  setLanguageSpinner("overviewLangSpinner", true);
  try {
    for (let start = 0; start < pending.length; start += 4) {
      const batch = pending.slice(start, start + 4);
      let result;
      try {
        result = await sendTranslationMessage({
          action: "translateContent",
          content: {
            segments: batch.map(({ id, text }) => ({ id, text })),
          },
          contentType: "uiTextBatch",
          targetLanguage: "zh",
          videoTitle: currentVideoTitle,
        });
      } catch (error) {
        result = { success: false, error: error.message || "Translation failed." };
      }

      if (
        generation !== overviewTranslationGeneration ||
        videoId !== currentVideoId ||
        analysis !== currentAnalysis
      ) {
        return;
      }

      const responseSegments = result?.success
        ? result.translatedContent?.segments
        : [];
      const aligned = alignTranslatedSegmentBatch(batch, responseSegments);
      aligned.forEach((item, index) => {
        const source = batch[index];
        if (result?.success && item.text) {
          source.apply(item.text);
          overviewTranslationErrors.delete(source.id);
        } else {
          overviewTranslationErrors.set(
            source.id,
            result?.error || item.error || ui("翻译失败，请点击中文或双语重试。", "Translation failed. Click Chinese or Bilingual to retry."),
          );
        }
      });
      renderAnalysisResults(analysis);
    }
    await saveToCache(videoId);
  } finally {
    if (generation === overviewTranslationGeneration) {
      setLanguageSpinner("overviewLangSpinner", false);
    }
  }
}

/**
 * Renders the analysis results into the Overview tab.
 * Shows chapters and key quotes only.
 */
function renderAnalysisResults(analysis) {
  // Chapters
  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = "";
  (analysis.chapters || []).forEach((chapter, index) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.seconds = chapter.timestampSeconds;
    li.innerHTML = `
      <span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${renderLocalizedText(chapter.title, chapter.titleZh, currentOverviewMode, overviewTranslationErrors.get(overviewFieldId("chapter", index, "title")) || "", { id: overviewFieldId("chapter", index, "title"), text: chapter.title })}</span>
        <span class="chapter-summary">${renderLocalizedText(chapter.summary || "", chapter.summaryZh, currentOverviewMode, overviewTranslationErrors.get(overviewFieldId("chapter", index, "summary")) || "", { id: overviewFieldId("chapter", index, "summary"), text: chapter.summary || "" })}</span>
      </div>
    `;
    li.addEventListener("click", () => {
      debugLog(
        "[TranslatorX Panel] Chapter clicked:",
        chapter.timestamp,
        chapter.timestampSeconds,
      );
      seekTo(chapter.timestampSeconds);
    });
    chapterList.appendChild(li);
  });

  // Quotes - sort by timestamp (chronological order)
  const quotesList = document.getElementById("quotesList");
  quotesList.innerHTML = "";
  (analysis.keyQuotes || []).forEach((quote, index) => {
    const div = document.createElement("div");
    div.className = "quote-item";
    div.dataset.seconds = quote.timestampSeconds;
    div.innerHTML = `
      <div class="quote-text">${renderLocalizedText(quote.quote, quote.quoteZh, currentOverviewMode, overviewTranslationErrors.get(overviewFieldId("quote", index, "quote")) || "", { id: overviewFieldId("quote", index, "quote"), text: quote.quote })}</div>
      <div class="quote-meta">
        <span class="quote-timestamp">${escapeHtml(quote.timestamp)}</span>
        <div class="quote-actions">
          <button class="quote-save-note-btn" title="${ui("保存为笔记", "Save this quote as a note")}">${ui("📝 笔记", "📝 Note")}</button>
          <button class="quote-copy-btn" title="${ui("复制引用", "Copy this quote")}">${ui("⧉ 复制", "⧉ Copy")}</button>
        </div>
      </div>
    `;
    div.addEventListener("click", () => {
      debugLog(
        "[TranslatorX Panel] Quote clicked:",
        quote.timestamp,
        quote.timestampSeconds,
      );
      seekTo(quote.timestampSeconds);
    });

    const quoteCopyBtn = div.querySelector(".quote-copy-btn");
    quoteCopyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(
          getLocalizedPlainText(quote.quote, quote.quoteZh, currentOverviewMode),
        );
        quoteCopyBtn.textContent = ui("✓ 已复制", "✓ Copied");
        setTimeout(() => {
          quoteCopyBtn.textContent = ui("⧉ 复制", "⧉ Copy");
        }, 1500);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });

    const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
    quoteSaveNoteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveQuoteAsNote(quote, quoteSaveNoteBtn);
    });

    quotesList.appendChild(div);
  });
}

/**
 * Saves a key quote as a timestamped note.
 */
async function saveQuoteAsNote(quote, btn) {
  if (!currentVideoId) return;

  const originalText = btn.textContent;
  btn.textContent = ui("保存中…", "Saving...");
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: currentVideoId,
      timestamp: quote.timestampSeconds,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    });

    if (result.success) {
      btn.textContent = ui("✓ 已保存", "✓ Saved");
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
      // Refresh notes list if on Notes tab
      loadNotes(currentVideoId);
    } else {
      console.error("[TranslatorX] Save quote as note failed:", result.error);
      btn.textContent = ui("错误", "Error");
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
    }
  } catch (error) {
    console.error("[TranslatorX] Save quote as note error:", error);
    btn.textContent = ui("错误", "Error");
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);
  }
}

/**
 * Legacy function for backwards compatibility with cached data.
 * Renders both transcript and analysis.
 */
function renderResults(analysis) {
  renderAnalysisResults(analysis);

  renderTranscript();

  document.getElementById("tabsNav").style.display = "flex";

  // Setup explain feature for text selection
  setupExplainFeature();
}

/**
 * Returns true while the user has a range of text selected.
 * Transcript row clicks must not seek in that state: the click emitted after
 * selection mouseup belongs to the selection/explain interaction, not playback.
 */
function hasNonCollapsedTextSelection() {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed,
  );
}

/**
 * Preserves normal row-click seeking while keeping text selection inert.
 */
function seekFromTranscriptEntryClick(event, seconds) {
  if (hasNonCollapsedTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  seekTo(seconds);
}

function renderTranscript() {
  if (!currentTranscript) return;

  const transcriptList = document.getElementById("transcriptList");
  transcriptList.innerHTML = "";

  // Group entries using smart sentence-boundary + time-guardrail logic
  const grouped = groupTranscriptEntries(currentTranscript);

  grouped.forEach((group) => {
    const div = document.createElement("div");
    div.className = "transcript-entry";
    div.dataset.seconds = group.start;

    const minutes = Math.floor(group.start / 60);
    const seconds = Math.floor(group.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      <span class="transcript-text">${renderSubtitleInlineMarkup(group.text)}</span>
    `;

    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, group.start),
    );
    transcriptList.appendChild(div);
  });

  // Start tracking video playback for auto-scroll
  startPlaybackTracking();
}

function copyTranscript() {
  copyToClipboardWithFeedback(currentTranscriptText || "", "copyTranscriptBtn");
}

function exportTranscript() {
  const transcriptContent = currentTranscriptText || "";
  const videoUrl = `https://youtube.com/watch?v=${currentVideoId}`;

  let exportText = "";
  exportText += `TRANSCRIPT\n`;
  exportText += `${"=".repeat(60)}\n\n`;
  exportText += `Title: ${currentVideoTitle || "Unknown"}\n`;
  exportText += `Channel: ${currentChannelName || "Unknown"}\n`;
  exportText += `URL: ${videoUrl}\n`;
  exportText += `\n${"—".repeat(60)}\n\n`;

  if (currentVideoDescription) {
    exportText += `DESCRIPTION:\n${currentVideoDescription}\n`;
    exportText += `\n${"—".repeat(60)}\n\n`;
  }

  exportText += `TRANSCRIPT:\n\n${transcriptContent}\n`;
  exportText += `\n${"—".repeat(60)}\n`;
  exportText += `Exported by TranslatorX\n`;

  const filename = `${sanitizeFilename(currentVideoTitle)}-transcript.txt`;
  downloadTextFile(exportText, filename);
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function showState(state) {
  document.getElementById("welcomeState").style.display =
    state === "welcome" ? "flex" : "none";
  document.getElementById("loadingState").style.display =
    state === "loading" ? "block" : "none";
  document.getElementById("errorState").style.display =
    state === "error" ? "block" : "none";
  const uploadEl = document.getElementById("uploadState");
  if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
  document.getElementById("resultsState").style.display =
    state === "results" ? "block" : "none";

  // The tab bar only belongs on the results view. We toggle it HERE, in one
  // place, so it tracks the view automatically. Previously each caller had to
  // remember to re-show it after showState("results"), and one path forgot —
  // which is why the tabs could vanish when re-opening an already-analyzed video.
  document.getElementById("tabsNav").style.display =
    state === "results" ? "flex" : "none";

  if (state !== "results") {
    stopPlaybackTracking();
  }
}

function updateLoading(title, subtitle) {
  document.getElementById("loadingText").textContent = title;
  document.getElementById("loadingSubtext").textContent = subtitle;
}

function showError(title, message) {
  currentErrorView = { type: "general", title, message };
  errorAction = null;
  showState("error");
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorBtn").textContent = ui("重试", "Try Again");
}

function showConfigError(configStatus) {
  currentErrorView = { type: "config", status: { ...configStatus } };
  const missingKeys = [];
  if (!configStatus.hasAiKey) missingKeys.push("DeepSeek API Key");

  showState("error");
  document.getElementById("errorTitle").textContent = ui("缺少 API Key", "API Key Missing");
  document.getElementById("errorMessage").textContent = ui(
    `请在 TranslatorX 设置中填写 ${missingKeys.join(" 和 ")}。`,
    `Add ${missingKeys.join(" and ")} in TranslatorX Settings.`,
  );
  document.getElementById("errorBtn").textContent = ui("打开设置", "Open Settings");
  errorAction = () => chrome.runtime.sendMessage({ action: "openOptions" });
}

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });

  // Start/stop playback tracking based on which tab is active
  if (tabName === "transcript") {
    startPlaybackTracking();
  } else {
    stopPlaybackTracking();
  }

  // Lazy-load LLM analysis when user switches to Overview tab
  if (tabName === "overview" && !currentAnalysis && !isAnalysisLoading) {
    triggerAnalysis();
  }
}

/**
 * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
 * This saves tokens by not running analysis until needed.
 */
async function triggerAnalysis() {
  if (!currentTranscriptTimestamped || isAnalysisLoading || currentAnalysis)
    return;

  isAnalysisLoading = true;

  // Show loading indicators in the Overview tab
  const chapterList = document.getElementById("chapterList");
  const quotesList = document.getElementById("quotesList");

  if (chapterList)
    chapterList.innerHTML =
      `<li class="chapter-item" style="color: var(--text-muted); border: none;">${ui("正在生成章节…", "Loading chapters...")}</li>`;
  if (quotesList)
    quotesList.innerHTML =
      `<div class="quote-item" style="color: var(--text-muted); border-left-color: var(--border);">${ui("正在提取引用…", "Loading quotes...")}</div>`;

  try {
    const analysisResult = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
    });

    if (!analysisResult.success) {
      if (chapterList)
        chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">${ui("分析失败", "Analysis failed")}: ${escapeHtml(analysisResult.error || ui("未知错误", "Unknown error"))}</li>`;
      isAnalysisLoading = false;
      return;
    }

    currentAnalysis = analysisResult.analysis;
    renderAnalysisResults(currentAnalysis);
    highlightMomentsOnPage(currentAnalysis.keyMoments);

    if (currentOverviewMode !== "original") {
      await translateOverview();
    }

    // Save to cache now that we have analysis
    await saveToCache(currentVideoId);
  } catch (error) {
    console.error("[TranslatorX Panel] Analysis error:", error);
    if (chapterList)
      chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">${ui("错误", "Error")}: ${escapeHtml(error.message)}</li>`;
  }

  isAnalysisLoading = false;
}

// ============================================================
// TIMESTAMP / SEEK
// ============================================================

async function seekTo(seconds) {
  debugLog("[TranslatorX Panel] seekTo called with:", seconds);
  if (seconds === undefined || seconds === null) {
    debugLog("[TranslatorX Panel] seekTo aborted - no seconds value");
    return;
  }

  const payload = {
    action: "seekTo",
    seconds: Number(seconds),
  };

  try {
    // Try direct messaging to the stored YouTube tab first (fastest/reliable)
    if (youtubeTabId) {
      try {
        await chrome.tabs.sendMessage(youtubeTabId, payload);
        debugLog("[TranslatorX Panel] seekTo direct success");
        return;
      } catch (directErr) {
        debugLog(
          "[TranslatorX Panel] Direct seekTo failed, falling back to relay:",
          directErr.message,
        );
      }
    }

    // Fallback: route through background script
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload,
    });
    debugLog("[TranslatorX Panel] seekTo relay result:", result);
  } catch (error) {
    console.error("[TranslatorX Panel] seekTo error:", error);
  }
}

/**
 * Plays a saved note at its timestamp.
 * - If the note belongs to the video currently open, we seek the player in place.
 * - If it belongs to a DIFFERENT video (e.g. viewing "All Notes"), seeking the
 *   current player would jump to the wrong content, so we open that video in a
 *   new tab at the right timestamp instead.
 */
function playNote(note) {
  if (note.videoId && note.videoId === currentVideoId) {
    seekTo(note.timestampSeconds);
  } else {
    // note.timestampedUrl already includes the &t=<seconds>s anchor
    chrome.tabs.create({ url: note.timestampedUrl });
  }
}

async function highlightMomentsOnPage(moments) {
  if (!moments || !moments.length) return;

  try {
    // Route through background script for reliable message passing
    await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: {
        action: "highlightMoments",
        moments: moments,
        videoDuration: currentVideoDuration,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
  }
}

// ============================================================
// UTILITY
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Renders the small subset of inline formatting commonly present in subtitle
 * tracks and model translations. Everything is escaped first; only exact,
 * attribute-free allowlisted tags are restored as markup afterwards.
 */
function renderSubtitleInlineMarkup(text) {
  return escapeHtml(text).replace(
    /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
    (_match, closing, tagName) =>
      tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
}

async function copyToClipboardWithFeedback(text, buttonId) {
  const btn = document.getElementById(buttonId);
  const original = btn.textContent;

  const success = await copyToClipboard(text);
  if (success) {
    btn.textContent = ui("✓ 已复制", "✓ Copied");
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  }
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

// ============================================================
// TEXT SELECTION — EXPLAIN FEATURE
// ============================================================

/**
 * Sets up text selection handling in the transcript.
 * When user selects text, shows an "Explain" button.
 */
function setupExplainFeature() {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  // Remove existing tooltip if any
  const existingTooltip = document.getElementById("explainTooltip");
  if (existingTooltip) existingTooltip.remove();

  // Create the explain tooltip/button
  const tooltip = document.createElement("div");
  tooltip.id = "explainTooltip";
  tooltip.className = "explain-tooltip";
  tooltip.innerHTML = `<button class="explain-btn">${ui("💡 解释", "💡 Explain")}</button>`;
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  let selectedText = "";

  // Interacting with Explain must preserve the transcript selection and stay
  // isolated from document/row click behavior.
  tooltip.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  tooltip.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });
  tooltip.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  // Listen for text selection
  document.addEventListener("mouseup", (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    // Only show if selecting within transcript
    const isInTranscript = transcriptList.contains(selection.anchorNode);

    // Allow any selection length (removed 10+ char requirement)
    if (text.length > 0 && isInTranscript) {
      selectedText = text;

      // Position the tooltip near the selection
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      tooltip.style.display = "block";
      tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
    } else {
      tooltip.style.display = "none";
    }
  });

  // Hide tooltip when clicking elsewhere
  document.addEventListener("mousedown", (e) => {
    if (!tooltip.contains(e.target)) {
      tooltip.style.display = "none";
    }
  });

  // Handle explain button click
  tooltip
    .querySelector(".explain-btn")
    .addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedText) return;

      tooltip.style.display = "none";
      await showExplanation(selectedText);
    });
}

/**
 * Shows the explanation modal and fetches it from the configured AI provider.
 */
async function showExplanation(selectedText) {
  const existingModal = document.getElementById("explainModal");
  existingModal?._translatorxStopWaiting?.();
  existingModal?.remove();

  const explainWaitingSegment = {
    id: `explain-${Date.now()}-${selectedText.substring(0, 48)}`,
    text: selectedText,
  };

  // Create modal
  const modal = document.createElement("div");
  modal.id = "explainModal";
  modal.className = "explain-modal-overlay";
  modal.innerHTML = `
    <div class="explain-modal">
      <div class="explain-modal-header">
        <div class="explain-modal-title">${ui("解释", "Explain")}</div>
        <button class="explain-modal-close" id="closeExplain" type="button" aria-label="${ui("关闭解释", "Close explanation")}">✕</button>
      </div>
      <div class="explain-selected-text">"${escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-language-row">
        <span class="explain-language-caption">${ui("默认语言", "Default language")}</span>
        <div class="language-mode-control explain-mode-control" role="group" aria-label="${ui("默认解释语言", "Default explanation language")}">
          <button class="language-mode-btn explain-mode-btn ${currentExplainMode === "original" ? "active" : ""}" type="button" data-explain-mode="original" aria-pressed="${currentExplainMode === "original"}">${ui("英文", "English")}</button>
          <button class="language-mode-btn explain-mode-btn ${currentExplainMode === "zh" ? "active" : ""}" type="button" data-explain-mode="zh" aria-pressed="${currentExplainMode === "zh"}">${ui("中文", "Chinese")}</button>
          <button class="language-mode-btn explain-mode-btn ${currentExplainMode === "bilingual" ? "active" : ""}" type="button" data-explain-mode="bilingual" aria-pressed="${currentExplainMode === "bilingual"}">${ui("双语", "Bilingual")}</button>
        </div>
      </div>
      <div class="explain-modal-content" id="explanationContent">
        <div class="explain-loading">
          ${renderExplainWaitingState(explainWaitingSegment)}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let explainWaitingInterval = setInterval(() => {
    const waitingText = modal.querySelector(".explain-thinking-text");
    if (!modal.isConnected || !waitingText) {
      clearInterval(explainWaitingInterval);
      explainWaitingInterval = null;
      return;
    }
    waitingText.textContent = getAnimeWaitingMessage(
      explainWaitingSegment,
      true,
    );
    waitingText.classList.remove("is-refreshing");
    void waitingText.offsetWidth;
    waitingText.classList.add("is-refreshing");
  }, 2600);

  const stopExplainWaiting = () => {
    if (explainWaitingInterval !== null) {
      clearInterval(explainWaitingInterval);
      explainWaitingInterval = null;
    }
  };
  modal._translatorxStopWaiting = stopExplainWaiting;

  // Close handlers
  document
    .getElementById("closeExplain")
    .addEventListener("click", () => {
      stopExplainWaiting();
      modal.remove();
    });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      stopExplainWaiting();
      modal.remove();
    }
  });

  let explanationResult = null;
  const contentDiv = modal.querySelector("#explanationContent");
  modal.querySelectorAll(".explain-mode-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = normalizeExplainLanguageMode(button.dataset.explainMode);
      await saveExplainLanguageMode(mode);
      setLanguageModeButtons(".explain-mode-btn", "explainMode", mode);
      if (explanationResult && modal.isConnected) {
        contentDiv.innerHTML = renderExplanationMarkup(
          explanationResult.explanation,
          explanationResult.explanationZh,
          mode,
        );
      }
    });
  });

  // Get some context around the selection from the transcript
  const transcriptContext = getTranscriptContext(selectedText);

  // Fetch explanation
  try {
    const result = await chrome.runtime.sendMessage({
      action: "explainSelection",
      selectedText: selectedText,
      transcriptContext: transcriptContext,
      videoTitle: currentVideoTitle,
    });

    if (!modal.isConnected) {
      stopExplainWaiting();
      return;
    }
    stopExplainWaiting();
    if (result.success) {
      if (!result.explanation || !result.explanationZh) {
        throw new Error(ui("双语解释不完整，请重试。", "The bilingual explanation was incomplete. Please try again."));
      }
      explanationResult = result;
      contentDiv.innerHTML = renderExplanationMarkup(
        result.explanation,
        result.explanationZh,
        currentExplainMode,
      );
    } else {
      contentDiv.innerHTML = `<div class="explain-error">${ui("无法获取解释", "Failed to get explanation")}: ${escapeHtml(result.error)}</div>`;
    }
  } catch (error) {
    stopExplainWaiting();
    if (modal.isConnected) {
      contentDiv.innerHTML = `<div class="explain-error">${ui("错误", "Error")}: ${escapeHtml(error.message)}</div>`;
    }
  }
}

/**
 * Gets surrounding context from the transcript for the selected text.
 */
function getTranscriptContext(selectedText) {
  const fullText = currentTranscriptText || "";
  const index = fullText.indexOf(selectedText);

  if (index === -1) return "";

  // Get 200 chars before and after
  const start = Math.max(0, index - 200);
  const end = Math.min(fullText.length, index + selectedText.length + 200);

  return fullText.substring(start, end);
}

// ============================================================
// CACHING
// ============================================================

/**
 * Saves the current digest results to persistent local storage.
 * Results survive browser restarts — reopening the same video loads from cache
 * without consuming API tokens or Supadata calls.
 * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
 */
async function saveToCache(videoId) {
  if (!videoId || !currentTranscript) return;

  try {
    // Persist semantic-segment translations for this video.
    const paragraphCacheForVideo = {};
    for (const [key, value] of transcriptParagraphCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        paragraphCacheForVideo[key] = value;
      }
    }

    const cacheData = {
      analysis: currentAnalysis, // May be null if not yet analyzed
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      transcriptSource: currentTranscriptSource,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      paragraphCache: paragraphCacheForVideo,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [`digest_${videoId}`]: cacheData });
    debugLog(
      "Saved to cache:",
      videoId,
      currentAnalysis ? "(with analysis)" : "(transcript only)",
    );

    // Evict old entries if we have more than 20 videos cached
    await evictOldCacheEntries(20);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

/**
 * Keeps the cache from growing unbounded.
 * Removes the oldest entries when we exceed maxEntries videos.
 *
 * @param {number} maxEntries - Maximum number of cached videos to keep
 */
async function evictOldCacheEntries(maxEntries) {
  try {
    const allData = await chrome.storage.local.get(null);
    let digestKeys = Object.keys(allData).filter((k) =>
      k.startsWith("digest_"),
    );
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const expired = digestKeys.filter((key) => {
      const timestamp = Number(allData[key]?.timestamp) || 0;
      return Date.now() - timestamp > THIRTY_DAYS;
    });
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      const expiredSet = new Set(expired);
      digestKeys = digestKeys.filter((key) => !expiredSet.has(key));
    }

    if (digestKeys.length <= maxEntries) return;

    // Sort by timestamp (oldest first) and remove excess
    const sorted = digestKeys
      .map((k) => ({ key: k, ts: allData[k]?.timestamp || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const toRemove = sorted
      .slice(0, sorted.length - maxEntries)
      .map((e) => e.key);
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      debugLog(`[TranslatorX] Evicted ${toRemove.length} old cache entries`);
    }
  } catch (error) {
    console.error("Cache eviction error:", error);
  }
}

/**
 * Loads digest results from persistent local storage.
 * Returns null if not cached or expired (30-day expiry).
 */
async function loadFromCache(videoId) {
  if (!videoId) return null;

  try {
    const result = await chrome.storage.local.get(`digest_${videoId}`);
    const cached = result[`digest_${videoId}`];

    if (!cached) return null;

    // Cache expires after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > THIRTY_DAYS) {
      await chrome.storage.local.remove(`digest_${videoId}`);
      return null;
    }

    return cached;
  } catch (error) {
    console.error("Cache load error:", error);
    return null;
  }
}

/**
 * Updates the cache after enhance or translation operations.
 */
async function updateCache() {
  if (currentVideoId) {
    await saveToCache(currentVideoId);
  }
}

// ============================================================
// NOTES
// ============================================================

async function handleNotesModeChange(mode) {
  if (!LANGUAGE_MODES.includes(mode)) return;
  currentNotesMode = mode;
  notesTranslationGeneration += 1;
  setLanguageSpinner("notesLangSpinner", false);
  setLanguageModeButtons(".notes-mode-btn", "notesMode", mode);
  renderNotes(currentNotes, currentNotesFilterVideoId);
}

function getNoteChineseText(note) {
  return typeof note?.translations?.zh === "string"
    ? note.translations.zh.trim()
    : "";
}

function renderNoteText(note, error = "") {
  return renderLocalizedText(
    note?.text || "",
    getNoteChineseText(note),
    currentNotesMode,
    error,
  );
}

function updateNoteTranslationRow(note, error = "") {
  const row = document.querySelector(
    `.note-item[data-note-id="${CSS.escape(note.id)}"]`,
  );
  const text = row?.querySelector(".note-text");
  if (!text) return;
  text.innerHTML = renderNoteText(note, error);
}

async function requestNoteTranslationBatch(indices, notes, generation) {
  const sourceBatch = indices.map((index) => notes[index]);
  setLanguageSpinner("notesLangSpinner", true);
  try {
    let result;
    try {
      const sharedVideoId = sourceBatch[0]?.videoId;
      const sharedVideoTitle = sourceBatch.every(
        (note) => note.videoId === sharedVideoId,
      )
        ? sourceBatch[0]?.videoTitle || currentVideoTitle
        : "Saved notes from multiple videos";
      result = await sendTranslationMessage({
        action: "translateContent",
        content: {
          segments: sourceBatch.map((note) => ({
            id: note.id,
            text: note.text,
          })),
        },
        contentType: "uiTextBatch",
        targetLanguage: "zh",
        videoTitle: sharedVideoTitle,
      });
    } catch (error) {
      result = { success: false, error: error.message || "Translation failed." };
    }

    if (generation !== notesTranslationGeneration || notes !== currentNotes) {
      return;
    }

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    const translationsToSave = [];
    aligned.forEach((item, batchIndex) => {
      const note = sourceBatch[batchIndex];
      if (result?.success && item.text) {
        note.translations = {
          ...(note.translations && typeof note.translations === "object"
            ? note.translations
            : {}),
          zh: item.text,
        };
        notesTranslationErrors.delete(note.id);
        translationsToSave.push({ noteId: note.id, text: item.text });
        updateNoteTranslationRow(note);
      } else {
        const error =
          result?.error ||
          item.error ||
          ui("翻译失败，请点击中文或双语重试。", "Translation failed. Click Chinese or Bilingual to retry.");
        notesTranslationErrors.set(note.id, error);
        updateNoteTranslationRow(note, error);
      }
    });

    if (translationsToSave.length) {
      try {
        await chrome.runtime.sendMessage({
          action: "saveNoteTranslations",
          translations: translationsToSave,
        });
      } catch (error) {
        console.error("[TranslatorX Panel] Save note translations error:", error);
      }
    }
  } finally {
    setLanguageSpinner("notesLangSpinner", false);
  }
}

function setupNotesTranslationQueue() {
  if (notesTranslationObserver) notesTranslationObserver.disconnect();
  notesTranslationObserver = null;
  if (currentNotesMode === "original" || !currentNotes.length) return;

  const notes = currentNotes;
  const generation = ++notesTranslationGeneration;
  const queue = [];
  const queued = new Set();
  let processing = false;

  const processNext = async () => {
    if (processing || !queue.length || generation !== notesTranslationGeneration)
      return;
    processing = true;
    const indices = queue.splice(0, 4);
    indices.forEach((index) => queued.delete(index));
    try {
      await requestNoteTranslationBatch(indices, notes, generation);
    } finally {
      processing = false;
      if (queue.length && generation === notesTranslationGeneration) processNext();
    }
  };

  const enqueue = (index) => {
    const note = notes[index];
    if (!note || getNoteChineseText(note) || queued.has(index)) return;
    queue.push(index);
    queued.add(index);
    Promise.resolve().then(processNext);
  };

  notesTranslationObserver = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (a, b) =>
            Number(a.target.dataset.noteIndex) -
            Number(b.target.dataset.noteIndex),
        )
        .forEach((entry) => enqueue(Number(entry.target.dataset.noteIndex)));
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "320px 0px",
      threshold: 0,
    },
  );

  document.querySelectorAll("#notesList .note-item").forEach((row, index) => {
    if (!getNoteChineseText(notes[index])) notesTranslationObserver.observe(row);
    if (index < 4) enqueue(index);
  });
}

/**
 * Loads and renders notes from storage.
 * @param {string|null} videoId - Filter by video ID, or null for all notes
 */
async function loadNotes(videoId) {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: videoId,
    });

    if (result.success) {
      renderNotes(result.notes, videoId);
    }
  } catch (error) {
    console.error("[TranslatorX Panel] Load notes error:", error);
  }
}

function getNoteReflection(note) {
  return typeof note?.reflection === "string" ? note.reflection.trim() : "";
}

function formatNoteReflectionHtml(reflection) {
  return escapeHtml(reflection).replace(/\n/g, "<br>");
}

function setNoteReflectionEditor(noteEl, open) {
  const editor = noteEl.querySelector(".note-reflection-editor");
  const toggle = noteEl.querySelector(".note-reflection-toggle");
  if (!editor || !toggle) return;
  editor.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  noteEl.classList.toggle("reflection-open", open);
  if (open) noteEl.querySelector(".note-reflection-input")?.focus();
}

async function saveNoteReflection(note, noteEl) {
  const input = noteEl.querySelector(".note-reflection-input");
  const status = noteEl.querySelector(".note-reflection-status");
  const saveButton = noteEl.querySelector(".note-reflection-save");
  if (!input || !status || !saveButton) return;

  const reflection = input.value.trim();
  saveButton.disabled = true;
  status.textContent = ui("正在保存…", "Saving…");
  status.classList.remove("is-error");
  try {
    const result = await chrome.runtime.sendMessage({
      action: "updateNoteReflection",
      noteId: note.id,
      reflection,
    });
    if (!result?.success) {
      throw new Error(result?.error || "Could not save the reflection");
    }

    note.reflection = result.reflection || "";
    const preview = noteEl.querySelector(".note-reflection-preview");
    noteEl.classList.toggle("has-reflection", Boolean(note.reflection));
    preview?.classList.toggle("is-empty", !note.reflection);
    if (preview) {
      preview.innerHTML = note.reflection
        ? formatNoteReflectionHtml(note.reflection)
        : escapeHtml(ui("点击写下评论或灵感", "Click to add a thought or reflection"));
    }
    status.textContent = "";
    setNoteReflectionEditor(noteEl, false);
  } catch (error) {
    console.error("[TranslatorX Panel] Save reflection error:", error);
    status.textContent = ui("保存失败，请重试", "Save failed. Please retry.");
    status.classList.add("is-error");
  } finally {
    saveButton.disabled = false;
  }
}

/**
 * Renders the notes list in the Notes tab.
 */
function renderNotes(notes, filteredVideoId) {
  const notesList = document.getElementById("notesList");
  const notesIntro = document.getElementById("notesIntro");

  if (!notesList) return;

  currentNotes = Array.isArray(notes) ? notes : [];
  currentNotesFilterVideoId = filteredVideoId;
  if (notesTranslationObserver) notesTranslationObserver.disconnect();
  notesTranslationObserver = null;

  notesList.innerHTML = "";

  if (!notes || notes.length === 0) {
    notesIntro.style.display = "block";
    notesIntro.textContent = filteredVideoId
      ? ui(
          "当前视频还没有笔记。将鼠标移到视频上，点击 📝 笔记即可保存。",
          "No notes for this video yet. Hover over the video and click 📝 Note to save.",
        )
      : ui(
          "还没有保存笔记。将鼠标移到视频上，点击 📝 笔记即可保存。",
          "No notes saved yet. Hover over a video and click 📝 Note to save.",
        );
    return;
  }

  notesIntro.style.display = "none";

  notes.forEach((note, index) => {
    const reflection = getNoteReflection(note);
    const noteEl = document.createElement("div");
    noteEl.className = `note-item${reflection ? " has-reflection" : ""}`;
    noteEl.dataset.noteId = note.id;
    noteEl.dataset.noteIndex = index;
    noteEl.innerHTML = `
      <div class="note-header">
        <span class="note-timestamp" data-url="${escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${escapeHtml(note.timestamp)}</span>
        ${!filteredVideoId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
        <button class="note-delete" data-id="${escapeHtml(note.id)}" title="${ui("删除笔记", "Delete note")}">✕</button>
      </div>
      <div class="note-text">${renderNoteText(note, notesTranslationErrors.get(note.id) || "")}</div>
      <div class="note-actions">
        <button class="note-action-btn note-copy-text">${ui("⧉ 复制文字", "⧉ Copy text")}</button>
        <button class="note-action-btn note-copy-link" data-url="${escapeHtml(note.timestampedUrl)}">${ui("🔗 复制时间点", "🔗 Copy timestamp")}</button>
        <button class="note-action-btn note-play" data-seconds="${Number(note.timestampSeconds) || 0}">${ui("▶ 播放", "▶ Play")}</button>
      </div>
      <section class="note-reflection" aria-label="${ui("我的灵感", "My reflection")}">
        <button class="note-reflection-toggle" type="button" aria-expanded="false">
          <span class="note-reflection-kicker">${ui("我的灵感", "My reflection")}</span>
          <span class="note-reflection-preview${reflection ? "" : " is-empty"}">${reflection ? formatNoteReflectionHtml(reflection) : escapeHtml(ui("点击写下评论或灵感", "Click to add a thought or reflection"))}</span>
          <span class="note-reflection-chevron" aria-hidden="true">⌄</span>
        </button>
        <div class="note-reflection-editor" hidden>
          <label class="note-reflection-label" for="reflection-${escapeHtml(note.id)}">${ui("补充你的评论、联想或下一步行动", "Add your comment, connection, or next action")}</label>
          <textarea class="note-reflection-input" id="reflection-${escapeHtml(note.id)}" maxlength="3000" rows="4" placeholder="${ui("例如：这和我正在做的项目有什么联系？", "For example: How does this connect to my project?")}">${escapeHtml(reflection)}</textarea>
          <div class="note-reflection-footer">
            <span class="note-reflection-status" role="status"></span>
            <button class="note-reflection-cancel" type="button">${ui("取消", "Cancel")}</button>
            <button class="note-reflection-save" type="button">${ui("保存灵感", "Save reflection")}</button>
          </div>
        </div>
      </section>
    `;

    // Timestamp click - play from this point (in this tab or a new one)
    noteEl.querySelector(".note-timestamp").addEventListener("click", (event) => {
      event.stopPropagation();
      playNote(note);
    });

    // Delete button
    noteEl
      .querySelector(".note-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteNote(note.id);
        loadNotes(filteredVideoId);
      });

    // Copy text button — copies just the note's text
    noteEl
      .querySelector(".note-copy-text")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            getLocalizedPlainText(
              note.text,
              getNoteChineseText(note),
              currentNotesMode,
            ),
          );
          const btn = noteEl.querySelector(".note-copy-text");
          btn.textContent = ui("✓ 已复制", "✓ Copied!");
          setTimeout(() => {
            btn.textContent = ui("⧉ 复制文字", "⧉ Copy text");
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Copy timestamp button — copies the timestamped YouTube link
    noteEl
      .querySelector(".note-copy-link")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.timestampedUrl);
          const btn = noteEl.querySelector(".note-copy-link");
          btn.textContent = ui("✓ 已复制", "✓ Copied!");
          setTimeout(() => {
            btn.textContent = ui("🔗 复制时间点", "🔗 Copy timestamp");
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Play button (in this tab if it's the current video, else a new tab)
    noteEl.querySelector(".note-play").addEventListener("click", () => {
      playNote(note);
    });

    const reflectionToggle = noteEl.querySelector(".note-reflection-toggle");
    reflectionToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setNoteReflectionEditor(
        noteEl,
        reflectionToggle.getAttribute("aria-expanded") !== "true",
      );
    });

    const reflectionInput = noteEl.querySelector(".note-reflection-input");
    reflectionInput.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    reflectionInput.addEventListener("keydown", async (event) => {
      if (event.key === "Escape") {
        reflectionInput.value = getNoteReflection(note);
        setNoteReflectionEditor(noteEl, false);
        return;
      }
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        await saveNoteReflection(note, noteEl);
      }
    });
    noteEl.querySelector(".note-reflection-cancel").addEventListener("click", (event) => {
      event.stopPropagation();
      noteEl.querySelector(".note-reflection-input").value = getNoteReflection(note);
      noteEl.querySelector(".note-reflection-status").textContent = "";
      setNoteReflectionEditor(noteEl, false);
    });
    noteEl.querySelector(".note-reflection-save").addEventListener("click", async (event) => {
      event.stopPropagation();
      await saveNoteReflection(note, noteEl);
    });

    // Clicking the card body is a shortcut to the reflection editor. Existing
    // action controls stay independent, and selecting note text for Explain
    // never loses its selection to the editor focus.
    noteEl.addEventListener("click", (event) => {
      if (event.target.closest("button, textarea, a")) return;
      if (window.getSelection()?.toString().trim()) return;
      setNoteReflectionEditor(noteEl, true);
    });

    notesList.appendChild(noteEl);
  });

  if (currentNotesMode !== "original") setupNotesTranslationQueue();
}

/**
 * Deletes a note by ID.
 */
async function deleteNote(noteId) {
  try {
    await chrome.runtime.sendMessage({
      action: "deleteNote",
      noteId: noteId,
    });
  } catch (error) {
    console.error("[TranslatorX Panel] Delete note error:", error);
  }
}

// ============================================================
// AUTO-SCROLL — Follow video playback in transcript
// ============================================================
// While a video plays, the transcript keeps the currently spoken semantic
// segment near the visual center. Explicit user scrolling pauses following so
// they can read ahead; programmatic scroll events never pause it.

/**
 * Starts polling the video's current time and highlighting/scrolling
 * to the matching transcript entry.
 */
function startPlaybackTracking() {
  if (!currentTranscript || !currentTranscript.length) return;

  // Don't restart if already tracking (preserves user's auto-scroll state)
  if (autoScrollInterval) return;

  autoScrollEnabled = true;
  setPlaybackFocusMode(true);
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Poll video time every 500ms
  autoScrollInterval = setInterval(() => playbackTrackingTick(), 500);
  playbackTrackingTick();

  // Listen for explicit user scroll intent. A plain `scroll` event cannot tell
  // user input from scrollTo({ behavior: "smooth" }), which previously made
  // the extension disable its own follow mode.
  const contentArea = document.getElementById("contentArea");
  contentArea.removeEventListener("wheel", onPlaybackWheel);
  contentArea.removeEventListener("touchstart", onPlaybackTouchStart);
  contentArea.removeEventListener("touchmove", onPlaybackTouchMove);
  contentArea.removeEventListener("pointerdown", onPlaybackScrollbarPointerDown);
  contentArea.addEventListener("wheel", onPlaybackWheel, { passive: true });
  contentArea.addEventListener("touchstart", onPlaybackTouchStart, {
    passive: true,
  });
  contentArea.addEventListener("touchmove", onPlaybackTouchMove, {
    passive: true,
  });
  contentArea.addEventListener("pointerdown", onPlaybackScrollbarPointerDown);
  document.removeEventListener("keydown", onPlaybackScrollKey);
  document.addEventListener("keydown", onPlaybackScrollKey);
}

/**
 * Stops playback tracking entirely. Called when leaving transcript tab,
 * starting a new digest, or leaving results state.
 */
function stopPlaybackTracking() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollEnabled = true; // Reset for next time
  playbackTouchStartY = null;
  setPlaybackFocusMode(false);
  if (playbackCenterFrame !== null) {
    window.cancelAnimationFrame(playbackCenterFrame);
    playbackCenterFrame = null;
  }
  document.getElementById("followPlaybackBtn").style.display = "none";

  const contentArea = document.getElementById("contentArea");
  contentArea?.removeEventListener("wheel", onPlaybackWheel);
  contentArea?.removeEventListener("touchstart", onPlaybackTouchStart);
  contentArea?.removeEventListener("touchmove", onPlaybackTouchMove);
  contentArea?.removeEventListener(
    "pointerdown",
    onPlaybackScrollbarPointerDown,
  );
  document.removeEventListener("keydown", onPlaybackScrollKey);

  // Remove active highlights
  document
    .querySelectorAll(".transcript-entry.active-playback")
    .forEach((el) => {
      el.classList.remove("active-playback");
      el.removeAttribute("aria-current");
    });
}

/**
 * One tick of the playback tracker. Gets current video time from the
 * YouTube tab and highlights + scrolls to the matching transcript entry.
 */
async function playbackTrackingTick() {
  try {
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      payload: { action: "getCurrentTime" },
    });

    if (!result.success || !result.response) return;

    const currentTime = result.response.currentTime || 0;
    highlightActiveEntry(currentTime);
  } catch (error) {
    // Silently ignore — YouTube tab might be closed or navigated away
  }
}

/**
 * Scrolls the transcript to the entry currently being spoken (the one
 * carrying the active-playback highlight). Returns false if nothing is
 * highlighted yet.
 */
function scrollToActiveEntry() {
  const activeEntry = document.querySelector(
    "#transcriptList .transcript-entry.active-playback",
  );
  if (!activeEntry) return false;

  return scheduleTranscriptCentering(activeEntry, true);
}

/**
 * Keeps the enlarged current subtitle as a dedicated reading focus only while
 * automatic playback following is active. Manual navigation returns the list
 * to its compact scanning layout.
 */
function setPlaybackFocusMode(enabled) {
  document
    .getElementById("transcriptList")
    ?.classList.toggle("is-following-playback", Boolean(enabled));
}

/**
 * Waits for the active-row class to finish changing layout before measuring.
 * This prevents the old compact height from being centered and then drifting
 * when the bilingual focus card expands.
 */
function scheduleTranscriptCentering(entry, force = false) {
  if (!entry) return false;
  if (playbackCenterFrame !== null) {
    window.cancelAnimationFrame(playbackCenterFrame);
  }
  playbackCenterFrame = window.requestAnimationFrame(() => {
    playbackCenterFrame = null;
    if (
      !autoScrollEnabled ||
      !entry.isConnected ||
      !entry.classList.contains("active-playback")
    ) {
      return;
    }
    centerTranscriptEntry(entry, force);
  });
  return true;
}

function calculateCenteredScrollTop({
  scrollTop,
  scrollHeight,
  viewportTop,
  viewportHeight,
  entryTop,
  entryHeight,
}) {
  const entryCenter = entryTop + entryHeight / 2;
  const viewportCenter = viewportTop + viewportHeight / 2;
  const unclamped = scrollTop + entryCenter - viewportCenter;
  return Math.min(
    Math.max(0, scrollHeight - viewportHeight),
    Math.max(0, unclamped),
  );
}

function centerTranscriptEntry(entry, force = false) {
  const contentArea = document.getElementById("contentArea");
  if (!contentArea || !entry) return false;

  const viewport = contentArea.getBoundingClientRect();
  const entryRect = entry.getBoundingClientRect();
  const currentCenterDelta =
    entryRect.top + entryRect.height / 2 -
    (viewport.top + viewport.height / 2);
  if (!force && Math.abs(currentCenterDelta) <= PLAYBACK_CENTER_TOLERANCE_PX) {
    return true;
  }

  const top = calculateCenteredScrollTop({
    scrollTop: contentArea.scrollTop,
    scrollHeight: contentArea.scrollHeight,
    viewportTop: viewport.top,
    viewportHeight: viewport.height,
    entryTop: entryRect.top,
    entryHeight: entryRect.height,
  });
  contentArea.scrollTo({ top, behavior: "smooth" });
  return true;
}

/**
 * Finds the transcript entry matching the current playback time,
 * highlights it, and scrolls to it (if auto-scroll is enabled).
 *
 * @param {number} currentSeconds - Current video playback time in seconds
 */
function highlightActiveEntry(currentSeconds) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  const entries = transcriptList.querySelectorAll(".transcript-entry");
  if (entries.length === 0) return;

  // Find the entry whose time range contains the current playback time
  let activeEntry = null;
  entries.forEach((entry, index) => {
    const entrySeconds = parseInt(entry.dataset.seconds);
    const nextEntry = entries[index + 1];
    const nextSeconds = nextEntry
      ? parseInt(nextEntry.dataset.seconds)
      : Infinity;

    if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
      activeEntry = entry;
    }
  });

  if (!activeEntry) return;

  const alreadyActive = activeEntry.classList.contains("active-playback");

  if (!alreadyActive) {
    entries.forEach((e) => {
      e.classList.remove("active-playback");
      e.removeAttribute("aria-current");
    });
    activeEntry.classList.add("active-playback");
    activeEntry.setAttribute("aria-current", "true");
  }

  const activeIndex = Number(activeEntry.dataset.segmentIndex);
  activeTranslationQueue?.prioritizePlayback(activeIndex);

  // Re-check centering on every playback tick. This also compensates for row
  // height changes while a Chinese translation arrives above the active row.
  if (autoScrollEnabled) {
    scheduleTranscriptCentering(activeEntry, !alreadyActive);
  }
}

function pausePlaybackFollowing() {
  activeTranslationQueue?.setUserNavigation(true);
  if (autoScrollEnabled && autoScrollInterval) {
    autoScrollEnabled = false;
    setPlaybackFocusMode(false);
    if (playbackCenterFrame !== null) {
      window.cancelAnimationFrame(playbackCenterFrame);
      playbackCenterFrame = null;
    }
    document.getElementById("followPlaybackBtn").style.display = "block";
  }
}

function onPlaybackWheel() {
  pausePlaybackFollowing();
}

function onPlaybackTouchStart(event) {
  playbackTouchStartY = event.touches?.[0]?.clientY ?? null;
}

function onPlaybackTouchMove(event) {
  const currentY = event.touches?.[0]?.clientY;
  if (
    playbackTouchStartY !== null &&
    Number.isFinite(currentY) &&
    Math.abs(currentY - playbackTouchStartY) >= 8
  ) {
    pausePlaybackFollowing();
  }
}

function onPlaybackScrollbarPointerDown(event) {
  if (event.button !== 0) return;
  const contentArea = document.getElementById("contentArea");
  if (!contentArea) return;
  const rect = contentArea.getBoundingClientRect();
  const scrollbarWidth = Math.max(
    8,
    contentArea.offsetWidth - contentArea.clientWidth,
  );
  if (event.clientX >= rect.right - scrollbarWidth) {
    pausePlaybackFollowing();
  }
}

function onPlaybackScrollKey(event) {
  if (
    PLAYBACK_SCROLL_KEYS.has(event.key) &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    pausePlaybackFollowing();
  }
}

// ============================================================
// TRANSCRIPT MODE UI — Original / Chinese / aligned bilingual
// ============================================================

function getActiveTranscriptSegments() {
  return groupTranscriptEntries(currentTranscript || []);
}

function transcriptTranslationCacheKey(segment) {
  return `${currentVideoId}:zh:semantic:${segment.id}`;
}

function setTranscriptModeButtons(mode) {
  document.querySelectorAll(".transcript-mode-btn").forEach((button) => {
    const active = button.dataset.transcriptMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function handleTranscriptModeChange(mode) {
  if (!["original", "zh", "bilingual"].includes(mode)) return;
  if (mode === currentTranscriptMode) return;

  activeTranslationQueue?.dispose();
  activeTranslationQueue = null;
  translationGeneration += 1;
  await saveTranscriptLanguageMode(mode);
  translationWorkCount = 0;
  setTranslatingSpinner(false);
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  setTranscriptModeButtons(mode);

  if (mode === "original") {
    renderTranscript();
    return;
  }

  await translateTranscript();
}

function renderTranscriptSegmentContent(segment, mode, translated, error) {
  const original = renderSubtitleInlineMarkup(segment.text);
  let translationHtml = "";
  if (translated) {
    translationHtml = renderSubtitleInlineMarkup(translated);
  } else if (error) {
    translationHtml = `${escapeHtml(error)}<button class="translation-retry-btn" type="button">${ui("重试", "Retry")}</button>`;
  } else {
    translationHtml = renderAnimeWaitingState(segment);
  }

  if (mode === "bilingual") {
    return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
  }

  return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
}

function renderTranscriptModeRows(segments, mode) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return [];
  transcriptList.innerHTML = "";

  const rows = [];
  segments.forEach((segment, index) => {
    const div = document.createElement("div");
    const cached = transcriptParagraphCache.get(
      transcriptTranslationCacheKey(segment),
    );
    div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
    div.dataset.seconds = segment.start;
    div.dataset.segmentId = segment.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(segment.start / 60);
    const seconds = Math.floor(segment.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      ${renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, segment.start),
    );
    transcriptList.appendChild(div);
    rows.push(div);
  });

  startPlaybackTracking();
  return rows;
}

/**
 * Rebuilds a provider response in source order. Unknown IDs are ignored and
 * missing IDs remain explicit errors, never positional guesses.
 */
function alignTranslatedSegmentBatch(sourceSegments, responseSegments) {
  const translatedById = new Map();
  if (Array.isArray(responseSegments)) {
    responseSegments.forEach((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string")
        return;
      const text = item.text.trim();
      if (text && !translatedById.has(item.id)) {
        translatedById.set(item.id, text);
      }
    });
  }

  return sourceSegments.map((segment) => ({
    id: segment.id,
    text: translatedById.get(segment.id) || "",
    error: translatedById.has(segment.id) ? "" : "Translation unavailable.",
  }));
}

function updateTranslatedRow(segment, index, alignedItem, generation) {
  if (generation !== translationGeneration) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  if (!row) return;

  if (alignedItem.text) {
    transcriptParagraphCache.set(
      transcriptTranslationCacheKey(segment),
      alignedItem.text,
    );
  }

  const copy = row.querySelector(".transcript-copy");
  if (copy) {
    copy.outerHTML = renderTranscriptSegmentContent(
      segment,
      currentTranscriptMode,
      alignedItem.text,
      alignedItem.error,
    );
  }
  row.classList.toggle("translated", !!alignedItem.text);
  row.classList.toggle("translating", false);
  row.classList.toggle("translation-failed", !alignedItem.text);

  const retry = row.querySelector(".translation-retry-btn");
  if (retry) {
    ["mousedown", "mouseup"].forEach((eventName) => {
      retry.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      retryTranslationSegment(index, generation);
    });
  }
}

let activeTranslationQueue = null;

function createTranscriptTranslationQueue({
  segments,
  isCached,
  translateBatch,
  batchSize = TRANSCRIPT_TRANSLATION_BATCH_SIZE,
  initialPrefetchCount = TRANSCRIPT_INITIAL_PREFETCH_COUNT,
}) {
  const pending = new Map();
  const inFlight = new Set();
  const attempted = new Set();
  const visible = new Set();
  let sequence = 0;
  let running = 0;
  let disposed = false;
  let userNavigation = false;
  let pumpScheduled = false;

  const isValidIndex = (index) =>
    Number.isInteger(index) && index >= 0 && index < segments.length;

  const hasUrgentPending = () =>
    [...pending.values()].some(
      (task) => task.priority >= TRANSCRIPT_PRIORITY_USER_VISIBLE,
    );

  const schedulePump = () => {
    if (disposed || pumpScheduled) return;
    pumpScheduled = true;
    Promise.resolve().then(() => {
      pumpScheduled = false;
      pump();
    });
  };

  const enqueue = (
    index,
    priority = TRANSCRIPT_PRIORITY_INITIAL,
    force = false,
  ) => {
    if (
      !isValidIndex(index) ||
      disposed ||
      inFlight.has(index) ||
      (!force && attempted.has(index))
    ) return false;
    if (!force && isCached(index)) return false;
    const existing = pending.get(index);
    if (!existing) {
      pending.set(index, { index, priority, sequence: sequence++ });
    } else if (priority > existing.priority) {
      existing.priority = priority;
    }
    schedulePump();
    return true;
  };

  const takeNextBatch = () => {
    const ordered = [...pending.values()].sort(
      (a, b) => b.priority - a.priority || a.sequence - b.sequence,
    );
    if (!ordered.length) return [];
    const topPriority = ordered[0].priority;
    const candidates =
      topPriority >= TRANSCRIPT_PRIORITY_USER_VISIBLE
        ? ordered.filter(
            (task) => task.priority >= TRANSCRIPT_PRIORITY_USER_VISIBLE,
          )
        : ordered;
    const effectiveBatchSize =
      topPriority >= TRANSCRIPT_PRIORITY_PLAYBACK ? 1 : batchSize;
    const batch = candidates
      .slice(0, effectiveBatchSize)
      .map((task) => task.index);
    batch.forEach((index) => {
      pending.delete(index);
      inFlight.add(index);
      attempted.add(index);
    });
    return batch;
  };

  const runBatch = (indices) => {
    running += 1;
    Promise.resolve()
      .then(() => translateBatch(indices))
      .finally(() => {
        indices.forEach((index) => inFlight.delete(index));
        running = Math.max(0, running - 1);
        schedulePump();
      });
  };

  const pump = () => {
    if (disposed) return;
    // Background prefetch uses one request. When playback or an explicit user
    // scroll produces urgent work, one additional request may bypass it.
    const concurrencyLimit = hasUrgentPending() ? 2 : 1;
    while (running < concurrencyLimit && pending.size) {
      const batch = takeNextBatch();
      if (!batch.length) break;
      runBatch(batch);
    }
  };

  const setUserNavigation = (active) => {
    userNavigation = Boolean(active);
    if (userNavigation) {
      visible.forEach((index) =>
        enqueue(index, TRANSCRIPT_PRIORITY_USER_VISIBLE),
      );
    }
  };

  const setRowVisible = (index, isVisible) => {
    if (!isValidIndex(index) || disposed) return;
    if (isVisible) {
      visible.add(index);
      enqueue(
        index,
        userNavigation
          ? TRANSCRIPT_PRIORITY_USER_VISIBLE
          : TRANSCRIPT_PRIORITY_PASSIVE_VISIBLE,
      );
      return;
    }

    visible.delete(index);
    const task = pending.get(index);
    if (!task || task.priority >= TRANSCRIPT_PRIORITY_PLAYBACK) return;
    if (index < initialPrefetchCount) {
      task.priority = TRANSCRIPT_PRIORITY_INITIAL;
    } else {
      pending.delete(index);
    }
  };

  const prioritizePlayback = (index) => {
    if (!isValidIndex(index) || disposed) return;
    enqueue(index, TRANSCRIPT_PRIORITY_PLAYBACK);
    enqueue(index - 1, TRANSCRIPT_PRIORITY_PLAYBACK - 10);
    enqueue(index + 1, TRANSCRIPT_PRIORITY_PLAYBACK - 10);
  };

  const prefetchInitial = () => {
    const count = Math.min(initialPrefetchCount, segments.length);
    for (let index = 0; index < count; index += 1) {
      enqueue(index, TRANSCRIPT_PRIORITY_INITIAL);
    }
  };

  return {
    enqueue,
    prefetchInitial,
    prioritizePlayback,
    setRowVisible,
    setUserNavigation,
    dispose() {
      disposed = true;
      pending.clear();
      visible.clear();
    },
    snapshot() {
      return {
        pending: [...pending.values()]
          .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence)
          .map(({ index, priority }) => ({ index, priority })),
        inFlight: [...inFlight],
        attempted: [...attempted],
        running,
        userNavigation,
      };
    },
  };
}

async function requestTranscriptTranslationBatch(
  indices,
  segments,
  generation,
  videoId,
  mode,
) {
  const sourceBatch = indices.map((index) => segments[index]);
  setTranslatingSpinner(true);
  try {
    const result = await sendTranslationMessage({
      action: "translateContent",
      content: {
        segments: sourceBatch.map(({ id, text }) => ({ id, text })),
      },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle: currentVideoTitle,
    });

    const isStale =
      generation !== translationGeneration ||
      videoId !== currentVideoId ||
      mode !== currentTranscriptMode;
    if (isStale) return;

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    aligned.forEach((item, batchIndex) => {
      if (!result?.success) {
        item.error = result?.error || "Translation failed.";
      }
      updateTranslatedRow(
        sourceBatch[batchIndex],
        indices[batchIndex],
        item,
        generation,
      );
    });
    await updateCache();
  } catch (error) {
    if (generation !== translationGeneration) return;
    sourceBatch.forEach((segment, batchIndex) => {
      updateTranslatedRow(
        segment,
        indices[batchIndex],
        { id: segment.id, text: "", error: error.message || "Translation failed." },
        generation,
      );
    });
  } finally {
    setTranslatingSpinner(false);
  }
}

function retryTranslationSegment(index, generation) {
  if (generation !== translationGeneration || !activeTranslationQueue) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-index="${index}"]`,
  );
  if (row) {
    row.classList.add("translating");
    row.classList.remove("translation-failed");
    const translation = row.querySelector(".transcript-translation");
    if (translation) {
      translation.className = "transcript-translation translation-pending";
      translation.innerHTML = renderAnimeWaitingState(
        activeTranslationQueue.segments[index],
        true,
      );
    }
  }
  activeTranslationQueue.enqueue(index, TRANSCRIPT_PRIORITY_RETRY, true);
}

/**
 * Renders immediately and prefetches the first 30 semantic segments through
 * one background request at a time. Playback and explicit user navigation can
 * temporarily use a second request so the text being watched or read wins.
 */
async function translateTranscript() {
  const segments = getActiveTranscriptSegments();
  if (!segments.length || currentTranscriptMode === "original") return;

  translationGeneration += 1;
  const generation = translationGeneration;
  const videoId = currentVideoId;
  const mode = currentTranscriptMode;
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  activeTranslationQueue?.dispose();

  const rows = renderTranscriptModeRows(segments, mode);
  activeTranslationQueue = createTranscriptTranslationQueue({
    segments,
    isCached(index) {
      return transcriptParagraphCache.has(
        transcriptTranslationCacheKey(segments[index]),
      );
    },
    translateBatch(indices) {
      return requestTranscriptTranslationBatch(
        indices,
        segments,
        generation,
        videoId,
        mode,
      );
    },
  });
  activeTranslationQueue.segments = segments;

  transcriptScrollObserver = new IntersectionObserver(
    (observerEntries) => {
      observerEntries
        .sort(
          (a, b) =>
            Number(a.target.dataset.segmentIndex) -
            Number(b.target.dataset.segmentIndex),
        )
        .forEach((entry) =>
          activeTranslationQueue?.setRowVisible(
            Number(entry.target.dataset.segmentIndex),
            entry.isIntersecting,
          ),
        );
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "320px 0px",
      threshold: 0,
    },
  );

  rows.forEach((row, index) => {
    if (!row.classList.contains("translated")) transcriptScrollObserver.observe(row);
  });
  activeTranslationQueue.prefetchInitial();
}

function setTranslatingSpinner(show) {
  if (show) translationWorkCount += 1;
  else translationWorkCount = Math.max(0, translationWorkCount - 1);
  const isTranslating = translationWorkCount > 0;
  const spinner = document.getElementById("langSpinner");
  if (spinner) spinner.classList.toggle("visible", isTranslating);
}

// Pure helpers are exposed for the repository's Node tests. The extension does
// not read this object at runtime.
globalThis.__YTD_TRANSCRIPT_TESTING__ = {
  sendTranslationMessage,
  groupTranscriptEntries,
  splitOversizedThought,
  alignTranslatedSegmentBatch,
  getLocalizedPlainText,
  renderLocalizedText,
  normalizeTranscriptLanguageMode,
  normalizeExplainLanguageMode,
  renderExplanationMarkup,
  renderSubtitleInlineMarkup,
  renderTranscriptSegmentContent,
  createTranscriptTranslationQueue,
  calculateCenteredScrollTop,
  ANIME_WAITING_MESSAGES,
  getAnimeWaitingMessage,
  renderAnimeWaitingState,
  renderExplainWaitingState,
};
