/**
 * CONTENT SCRIPT
 *
 * This script runs ON the YouTube page itself. It can see and modify
 * the YouTube page DOM (the HTML elements).
 *
 * It handles:
 * 1. Extracting video info (title, channel name) from the page
 * 2. Injecting "key moment" markers onto YouTube's progress bar
 * 3. Adding a "Digest" button to YouTube's action bar (next to Share/Save)
 *
 * Think of it like a robot sitting inside the YouTube tab,
 * reading the page and making small visual changes.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// GLOBAL STATE
// ============================================================

let ytdNoteButton = null;
let ytdNoteButtonTimer = null;
let ytdNoteKeyboardListenerAdded = false;
let ytdNoteButtonRetryTimer = null;
let ytdDigestButton = null;
let digestButtonObserver = null;
let digestButtonReconcileTimer = null;
let digestButtonResizeListenerAdded = false;
let sidePanelPreparationPromise = null;
let uiLanguage = TX_UI_LANGUAGE.DEFAULT_LANGUAGE;

function ui(chinese, english) {
  return TX_UI_LANGUAGE.pick(uiLanguage, chinese, english);
}

function noteButtonMarkup(label) {
  return `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="margin-right: 7px;">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
    </svg>
    <span>${label}</span>
  `;
}

function applyInterfaceLanguage(language) {
  uiLanguage = TX_UI_LANGUAGE.normalize(language);
  if (ytdDigestButton) {
    ytdDigestButton.setAttribute(
      "aria-label",
      ui("打开 TranslatorX", "Open TranslatorX"),
    );
  }
  if (ytdNoteButton?.dataset.txState === "idle") {
    ytdNoteButton.innerHTML = noteButtonMarkup(ui("笔记", "Note"));
    ytdNoteButton.setAttribute(
      "aria-label",
      ui("保存当前时间点为笔记", "Save the current timestamp as a note"),
    );
  }
}

TX_UI_LANGUAGE.get().then(applyInterfaceLanguage);
chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[TX_UI_LANGUAGE.STORAGE_KEY]) return;
  applyInterfaceLanguage(changes[TX_UI_LANGUAGE.STORAGE_KEY].newValue);
});

// ============================================================
// INITIALIZATION
// ============================================================

/**
 * When the page loads, inject our Digest button and Note button.
 * We wait a bit for YouTube's UI to fully render.
 */
async function prepareSidePanelForCurrentTab() {
  if (!sidePanelPreparationPromise) {
    sidePanelPreparationPromise = chrome.runtime
      .sendMessage({ action: "prepareSidePanel" })
      .then((result) => {
        if (!result?.success) {
          throw new Error(result?.error || "Could not prepare the side panel");
        }
        return true;
      })
      .catch((error) => {
        sidePanelPreparationPromise = null;
        console.error("[TranslatorX] Failed to prepare side panel:", error);
        return false;
      });
  }
  return sidePanelPreparationPromise;
}

async function init() {
  // Register the global "n" keyboard shortcut once
  if (!ytdNoteKeyboardListenerAdded) {
    // Capture before YouTube's bubbling keyboard handler can consume plain N.
    document.addEventListener("keydown", handleNoteKeyboardShortcut, true);
    ytdNoteKeyboardListenerAdded = true;
  }

  // Chrome requires tab-specific side panel options to be committed before
  // the user gesture that opens it. Do not expose a clickable button until the
  // background service worker confirms that preparation is complete.
  const sidePanelReady = await prepareSidePanelForCurrentTab();
  if (!sidePanelReady) {
    setTimeout(init, 750);
    return;
  }

  // Try to inject the buttons immediately
  injectDigestButton();
  tryInjectNoteButton();

  // Also set up an observer to handle YouTube's dynamic content loading
  // (YouTube is an SPA, so elements appear/disappear as you navigate)
  setupButtonObserver();
  setupDigestButtonResizeListener();
}

/**
 * Attempts to inject the note button. If the player container isn't ready yet,
 * retry a few times with a short delay. YouTube renders the player asynchronously
 * after navigation, so a single immediate attempt can miss it.
 */
function tryInjectNoteButton() {
  if (!window.location.pathname.includes("/watch")) return;

  // Clear any existing retry so we don't stack timers
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  let attempts = 0;
  const maxAttempts = 30; // ~3 seconds of retrying

  function attempt() {
    attempts++;
    const playerContainer = document.querySelector(
      "#movie_player.html5-video-player, #movie_player, .html5-video-player",
    );

    if (playerContainer) {
      injectNoteButton();
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
      return;
    }

    if (attempts >= maxAttempts) {
      debugLog(
        "[TranslatorX Content] Player container not found after retries, giving up",
      );
      if (ytdNoteButtonRetryTimer) {
        clearInterval(ytdNoteButtonRetryTimer);
        ytdNoteButtonRetryTimer = null;
      }
    }
  }

  attempt();
  if (!ytdNoteButton || !ytdNoteButton.isConnected) {
    ytdNoteButtonRetryTimer = setInterval(attempt, 100);
  }
}

// Run init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the side panel or background script.
 * When they ask for video info, we read it from the page.
 * When they send key moments, we highlight them on the progress bar.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugLog("[TranslatorX Content] Received message:", message.action, message);

  if (message.action === "getVideoInfo") {
    // Read video title and channel name from the page
    const info = extractVideoInfo();
    debugLog("[TranslatorX Content] Returning video info:", info);
    sendResponse(info);
    return false; // Synchronous response
  }

  if (message.action === "highlightMoments") {
    // Key moment markers disabled — chapters are shown in the side panel only.
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "getCurrentTime") {
    // Return the current video playback time (used by auto-scroll)
    const video = document.querySelector("video.html5-main-video");
    sendResponse({
      currentTime: video ? Math.floor(video.currentTime) : 0,
      paused: video ? video.paused : true,
    });
    return false;
  }

  if (message.action === "seekTo") {
    // Jump the video to a specific timestamp
    debugLog("[TranslatorX Content] Seeking to:", message.seconds);
    seekToTimestamp(message.seconds);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "showNoteSavedFeedback") {
    // Show brief feedback that note was saved
    showNoteSavedToast(message.note);
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "saveCurrentNote") {
    // The side panel is a separate document. When it owns keyboard focus it
    // forwards the N shortcut here so the YouTube player timestamp is used.
    saveCurrentNote()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ success: false, error: error?.message || "Could not save note" }),
      );
    return true;
  }

  // Unknown action - still send a response to prevent hanging
  debugLog("[TranslatorX Content] Unknown action:", message.action);
  sendResponse({ success: false, error: "Unknown action" });
  return false;
});

// ============================================================
// DIGEST BUTTON INJECTION
// ============================================================

/**
 * Injects a "Digest" button into YouTube's action bar.
 * The button appears next to Share, Save, etc. below the video.
 *
 * When clicked, it opens the TranslatorX side panel.
 */
function isVisibleDigestHost(element) {
  if (!element || !element.isConnected) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * YouTube keeps hidden copies of its responsive action toolbar in the DOM.
 * querySelector() can return one of those 0x0 copies before the toolbar the
 * viewer can actually see, so inspect every candidate and resolve the native
 * button group inside the visible action row for the current video.
 */
function findDigestButtonHost() {
  const primaryActionRows = Array.from(
    document.querySelectorAll("ytd-watch-metadata #actions-inner"),
  );

  for (const actionRow of primaryActionRows) {
    if (!isVisibleDigestHost(actionRow)) continue;

    const visibleButtonGroup = Array.from(
      actionRow.querySelectorAll("#top-level-buttons-computed"),
    ).find(isVisibleDigestHost);
    if (visibleButtonGroup) return visibleButtonGroup;
  }

  const fallbackCandidates = Array.from(
    document.querySelectorAll(
      "ytd-watch-metadata #actions #top-level-buttons-computed, " +
        "ytd-watch-metadata #top-level-buttons-computed, " +
        "#primary #actions #top-level-buttons-computed",
    ),
  );

  return (
    fallbackCandidates.find(
      (candidate) =>
        isVisibleDigestHost(candidate) &&
        (candidate.closest("ytd-watch-metadata") ||
          candidate.closest("#primary")),
    ) || null
  );
}

function createDigestButton() {
  const digestButton = document.createElement("button");
  const defaultAvatarUrl =
    chrome.runtime.getURL?.("icons/translatorx-button-avatar-48.png") || "";
  const successAvatarUrl =
    chrome.runtime.getURL?.("icons/translatorx-success-ok-48.png") || "";
  let isOpening = false;

  digestButton.id = "ytd-digest-button";
  digestButton.type = "button";
  digestButton.setAttribute("aria-label", ui("打开 TranslatorX", "Open TranslatorX"));
  digestButton.setAttribute("aria-live", "polite");
  digestButton.innerHTML = `
    <img class="ytd-digest-avatar" src="${defaultAvatarUrl}" alt="" draggable="false" aria-hidden="true">
    <span class="ytd-digest-label">TranslatorX</span>
  `;

  const styleDigestAvatar = () => {
    const avatar = digestButton.querySelector?.(".ytd-digest-avatar");
    if (!avatar) return;
    avatar.style.cssText = `
      display: block;
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
      object-fit: cover;
      border: 1px solid rgba(201, 220, 255, 0.72);
      border-radius: 10px;
      background: #171a52;
      box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.1),
        0 0 12px rgba(109, 213, 255, 0.28);
      user-select: none;
      pointer-events: none;
    `;
  };
  styleDigestAvatar();

  const restoreDigestIdleState = () => {
    const avatar = digestButton.querySelector?.(".ytd-digest-avatar");
    const label = digestButton.querySelector?.(".ytd-digest-label");
    if (avatar && defaultAvatarUrl) avatar.src = defaultAvatarUrl;
    if (label) label.textContent = "TranslatorX";
    digestButton.setAttribute("aria-label", ui("打开 TranslatorX", "Open TranslatorX"));
    digestButton.style.background =
      "linear-gradient(135deg, #4d58cf 0%, #715cf1 62%, #5c79ee 100%)";
    digestButton.style.borderColor = "rgba(127, 151, 255, 0.44)";
    digestButton.style.boxShadow =
      "0 7px 18px rgba(66, 65, 172, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.18)";
    styleDigestAvatar();
    isOpening = false;
  };

  const showDigestOpenSuccess = () => {
    const avatar = digestButton.querySelector?.(".ytd-digest-avatar");
    const label = digestButton.querySelector?.(".ytd-digest-label");
    if (avatar && successAvatarUrl) avatar.src = successAvatarUrl;
    if (label) label.textContent = ui("已打开", "Opened");
    digestButton.setAttribute(
      "aria-label",
      ui("TranslatorX 已成功打开", "TranslatorX opened successfully"),
    );
    digestButton.style.background =
      "linear-gradient(135deg, #4459d2 0%, #6c63f2 54%, #3da6c7 100%)";
    digestButton.style.borderColor = "rgba(153, 232, 255, 0.82)";
    digestButton.style.boxShadow =
      "0 10px 28px rgba(68, 78, 192, 0.42), 0 0 0 4px rgba(109, 213, 255, 0.12)";

    avatar?.animate?.(
      [
        { transform: "scale(0.72) rotate(-8deg)", opacity: 0.4 },
        { transform: "scale(1.24) rotate(5deg)", opacity: 1, offset: 0.48 },
        { transform: "scale(1) rotate(0deg)", opacity: 1 },
      ],
      { duration: 620, easing: "cubic-bezier(.2,.9,.24,1.2)" },
    );
    digestButton.animate?.(
      [
        { transform: "translateY(-1px) scale(1)" },
        { transform: "translateY(-2px) scale(1.045)", offset: 0.45 },
        { transform: "translateY(-1px) scale(1)" },
      ],
      { duration: 680, easing: "cubic-bezier(.2,.8,.2,1)" },
    );

    setTimeout(() => {
      if (digestButton.isConnected) restoreDigestIdleState();
    }, 1500);
  };

  // A compact signal pill: indigo structure, one violet highlight, and a
  // tiny cyan rim. It stays distinct from YouTube's red play controls.
  digestButton.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 17px 0 6px;
    height: 38px;
    border: 1px solid rgba(127, 151, 255, 0.44);
    border-radius: 19px;
    background: linear-gradient(135deg, #4d58cf 0%, #715cf1 62%, #5c79ee 100%);
    color: white;
    font-family: "Roboto", "Arial", sans-serif;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.1px;
    cursor: pointer;
    margin-right: 8px;
    transition: background 0.2s, transform 0.16s, box-shadow 0.2s, border-color 0.2s;
    box-shadow: 0 7px 18px rgba(66, 65, 172, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    flex: 0 0 auto;
    align-self: center;
    width: max-content;
    min-width: max-content;
    max-width: max-content;
    white-space: nowrap;
  `;

  // Hover effects
  digestButton.addEventListener("mouseenter", () => {
    if (isOpening) return;
    digestButton.style.background =
      "linear-gradient(135deg, #424dbf 0%, #6650e5 62%, #4d6fe4 100%)";
    digestButton.style.borderColor = "rgba(148, 213, 255, 0.68)";
    digestButton.style.boxShadow =
      "0 10px 24px rgba(66, 65, 172, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.2)";
    digestButton.style.transform = "translateY(-1px)";
  });

  digestButton.addEventListener("mouseleave", () => {
    if (isOpening) return;
    digestButton.style.background =
      "linear-gradient(135deg, #4d58cf 0%, #715cf1 62%, #5c79ee 100%)";
    digestButton.style.borderColor = "rgba(127, 151, 255, 0.44)";
    digestButton.style.boxShadow =
      "0 7px 18px rgba(66, 65, 172, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.18)";
    digestButton.style.transform = "translateY(0)";
  });

  // Click handler — open the side panel
  digestButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpening) return;
    isOpening = true;

    const label = digestButton.querySelector?.(".ytd-digest-label");
    if (label) label.textContent = ui("打开中…", "Opening...");
    digestButton.setAttribute(
      "aria-label",
      ui("正在打开 TranslatorX", "Opening TranslatorX"),
    );
    digestButton
      .querySelector?.(".ytd-digest-avatar")
      ?.animate?.(
        [
          { transform: "translateY(0) scale(1)" },
          { transform: "translateY(-2px) scale(1.06)" },
          { transform: "translateY(0) scale(1)" },
        ],
        { duration: 540, iterations: 2, easing: "ease-in-out" },
      );

    debugLog("[TranslatorX] Digest button clicked");

    // Send message to background script to open side panel
    try {
      const result = await chrome.runtime.sendMessage({
        action: "openSidePanel",
      });
      if (!result?.success) {
        throw new Error(result?.error || "Chrome could not open the side panel");
      }
      showDigestOpenSuccess();
      debugLog("[TranslatorX] openSidePanel response:", result);
    } catch (err) {
      console.error("[TranslatorX] Failed to open side panel:", err);
      if (label) label.textContent = ui("请重试", "Retry");
      digestButton.style.background = "#3f438e";
      digestButton.setAttribute(
        "aria-label",
        ui("打开失败，请重试", "Could not open. Try again"),
      );
      digestButton.title = err?.message || "Could not open TranslatorX";
      setTimeout(() => {
        if (!digestButton.isConnected) return;
        restoreDigestIdleState();
        digestButton.title = "";
      }, 2200);
    }
  });

  ytdDigestButton = digestButton;
  return digestButton;
}

/**
 * Reconciles the Digest button with YouTube's currently visible action row.
 * This is intentionally idempotent because YouTube rebuilds its watch page
 * during navigation and at responsive breakpoints.
 */
function injectDigestButton() {
  const existingButtons = Array.from(
    document.querySelectorAll("#ytd-digest-button"),
  );

  if (!window.location.pathname.includes("/watch")) {
    existingButtons.forEach((button) => button.remove());
    ytdDigestButton = null;
    return false;
  }

  const actionsContainer = findDigestButtonHost();
  if (!actionsContainer) {
    debugLog("[TranslatorX Content] Visible actions container not found yet");
    return false;
  }

  let digestButton = existingButtons.find(
    (button) => button === ytdDigestButton,
  );

  if (!digestButton) {
    existingButtons.forEach((button) => button.remove());
    existingButtons.length = 0;
    digestButton = createDigestButton();
  }

  existingButtons.forEach((button) => {
    if (button !== digestButton) button.remove();
  });

  if (digestButton.parentElement !== actionsContainer) {
    // YouTube turns #actions-inner into a vertical flex column at narrow
    // breakpoints. A direct child there stretches into a full-width second
    // row, so keep Digest inside the native horizontal button group and
    // prepend it to preserve visibility when space is limited.
    actionsContainer.insertBefore(digestButton, actionsContainer.firstChild);
  }

  debugLog("[TranslatorX Content] Digest button reconciled");
  return true;
}

function scheduleDigestButtonReconciliation(delay = 80) {
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
  }

  digestButtonReconcileTimer = setTimeout(() => {
    digestButtonReconcileTimer = null;
    injectDigestButton();
  }, delay);
}

function setupDigestButtonResizeListener() {
  if (digestButtonResizeListenerAdded) return;

  window.addEventListener("resize", () => {
    scheduleDigestButtonReconciliation(120);
  });
  digestButtonResizeListenerAdded = true;
}

/**
 * Sets up a MutationObserver to watch for YouTube's dynamic content changes.
 * When the action buttons container appears (after navigation), we inject our button.
 */
function setupButtonObserver() {
  if (digestButtonObserver) return;

  digestButtonObserver = new MutationObserver(() => {
    // Check if we need to inject the buttons
    if (window.location.pathname.includes("/watch")) {
      scheduleDigestButtonReconciliation();
      if (!ytdNoteButton || !ytdNoteButton.isConnected) {
        tryInjectNoteButton();
      }
    }
  });

  // Watch the entire body for changes (YouTube rebuilds large chunks of the DOM)
  digestButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// ============================================================
// NOTE BUTTON (Overlay on Video Player)
// ============================================================

/**
 * Injects a "Note" button overlay on top of the YouTube video player.
 * The button appears when the mouse enters or moves over the player and hides
 * after the cursor stays still for more than 2 seconds or leaves the player.
 */
function injectNoteButton() {
  // Don't inject if we're not on a video page
  if (!window.location.pathname.includes("/watch")) return;

  // Don't inject if button already exists and is properly tracked.
  // If a stale button exists (e.g., from a previous content-script instance),
  // remove it and re-inject so event listeners are attached to the live one.
  const existingButton = document.getElementById("ytd-note-button");
  if (existingButton) {
    if (ytdNoteButton === existingButton && existingButton.isConnected) {
      return; // already injected and connected
    }
    existingButton.remove();
  }

  // Find the video player container. YouTube rebuilds this dynamically, so
  // we try the most common selectors.
  const playerContainer = document.querySelector(
    "#movie_player.html5-video-player, " +
      "#movie_player, " +
      ".html5-video-player",
  );

  if (!playerContainer) {
    debugLog(
      "[TranslatorX Content] Player container not found yet, will retry",
    );
    return;
  }

  // Ensure the player container has relative positioning for absolute children
  if (
    window.getComputedStyle(playerContainer).position === "static" ||
    !playerContainer.style.position
  ) {
    playerContainer.style.position = "relative";
  }

  debugLog("[TranslatorX Content] Injecting note button");

  // Create the note button — a cool signal pill that floats over the player.
  const noteButton = document.createElement("button");
  noteButton.id = "ytd-note-button";
  noteButton.dataset.txState = "idle";
  noteButton.innerHTML = noteButtonMarkup(ui("笔记", "Note"));
  noteButton.setAttribute(
    "aria-label",
    ui("保存当前时间点为笔记", "Save the current timestamp as a note"),
  );

  // Keep this in the same visual family as the primary TranslatorX action.
  // Start hidden; visibility is controlled by mouse activity.
  noteButton.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 9999;
    display: flex;
    align-items: center;
    padding: 9px 16px;
    background: linear-gradient(135deg, #4d58cf 0%, #715cf1 100%);
    color: white;
    border: none;
    border-radius: 999px;
    font-family: system-ui, -apple-system, "Roboto", sans-serif;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.2px;
    cursor: pointer;
    transition: opacity 0.18s ease, transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
    opacity: 0;
    pointer-events: none;
    box-shadow: 0 7px 20px rgba(27, 29, 87, 0.38), inset 0 1px 0 rgba(255,255,255,0.16);
  `;

  ytdNoteButton = noteButton;

  // Show button when mouse enters or moves over the player.
  // Hide after 2 seconds of idle or when the mouse leaves.
  playerContainer.addEventListener("mouseenter", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mousemove", () => {
    showNoteButton();
    resetNoteButtonTimer();
  });

  playerContainer.addEventListener("mouseleave", () => {
    clearTimeout(ytdNoteButtonTimer);
    ytdNoteButtonTimer = null;
    hideNoteButton();
  });

  // Hover effect — lift slightly
  noteButton.addEventListener("mouseenter", () => {
    noteButton.style.background = "linear-gradient(135deg, #424dbf 0%, #6650e5 100%)";
    noteButton.style.boxShadow = "0 10px 24px rgba(27,29,87,0.44)";
    noteButton.style.transform = "translateY(-1px)";
  });

  noteButton.addEventListener("mouseleave", () => {
    noteButton.style.background = "linear-gradient(135deg, #4d58cf 0%, #715cf1 100%)";
    noteButton.style.boxShadow = "0 7px 20px rgba(27,29,87,0.38)";
    noteButton.style.transform = "translateY(0)";
  });

  // Click handler — save the current moment as a note
  noteButton.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await saveCurrentNote();
  });

  playerContainer.appendChild(noteButton);

  debugLog("[TranslatorX Content] Note button injected");
}

function showNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "1";
  ytdNoteButton.style.pointerEvents = "auto";
}

function hideNoteButton() {
  if (!ytdNoteButton) return;
  ytdNoteButton.style.opacity = "0";
  ytdNoteButton.style.pointerEvents = "none";
}

function resetNoteButtonTimer() {
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = setTimeout(() => {
    hideNoteButton();
  }, 2000);
}

/**
 * Handles the "n" keyboard shortcut for saving a note.
 * Only triggers on YouTube watch pages and when the user is not typing
 * in an input field.
 */
function handleNoteKeyboardShortcut(e) {
  if (!window.location.pathname.includes("/watch")) return;
  if (e.key !== "n" && e.key !== "N") return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

  // Ignore if the user is typing in a search box, form control, or editable
  // surface. event.target is important now that this listener runs in capture.
  const active = e.target || document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      active.isContentEditable ||
      active.closest?.('[contenteditable="true"], [role="textbox"]'))
  ) {
    return;
  }

  // Prevent YouTube's own "n" shortcut (e.g. next video in playlist)
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation?.();

  // Show brief visual feedback on the button, then save
  showNoteButton();
  resetNoteButtonTimer();
  saveCurrentNote();
}

/**
 * Captures the current timestamp and saves it as a note.
 */
async function saveCurrentNote() {
  debugLog("[TranslatorX] Saving note");

  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[TranslatorX] No video element found");
    return { success: false, error: "No active YouTube video found" };
  }

  // Go back 3 seconds to capture what was just said (user reacts after hearing it)
  const currentTime = Math.max(0, Math.floor(video.currentTime) - 3);
  const videoInfo = extractVideoInfo();
  const videoId = new URLSearchParams(window.location.search).get("v");

  const noteButton = ytdNoteButton;
  if (noteButton) {
    noteButton.dataset.txState = "saving";
    noteButton.innerHTML = `<span style="letter-spacing: 0.2px;">${ui("保存中…", "SAVING...")}</span>`;
    noteButton.style.pointerEvents = "none";
  }

  let outcome;
  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: videoId,
      timestamp: currentTime,
      videoTitle: videoInfo.title,
      channelName: videoInfo.channelName,
    });

    if (result.success) {
      if (noteButton) {
        noteButton.dataset.txState = "saved";
        noteButton.innerHTML = `<span style="letter-spacing: 0.2px;">${ui("已保存", "SAVED")}</span>`;
        noteButton.style.background = "#438b98";
      }
      showNoteSavedToast(result.note);
      outcome = { success: true, note: result.note };
    } else {
      if (noteButton) {
        noteButton.dataset.txState = "error";
        noteButton.innerHTML = `<span style="letter-spacing: 0.2px;">${ui("错误", "ERROR")}</span>`;
      }
      console.error("[TranslatorX] Save note error:", result.error);
      outcome = {
        success: false,
        error: result.error || "Could not save note",
      };
    }
  } catch (err) {
    if (noteButton) {
      noteButton.dataset.txState = "error";
      noteButton.innerHTML = `<span style="letter-spacing: 0.2px;">${ui("错误", "ERROR")}</span>`;
    }
    console.error("[TranslatorX] Save note exception:", err);
    outcome = {
      success: false,
      error: err?.message || "Could not save note",
    };
  }

  setTimeout(() => {
    if (noteButton) {
      noteButton.dataset.txState = "idle";
      noteButton.innerHTML = noteButtonMarkup(ui("笔记", "Note"));
      noteButton.style.background = "linear-gradient(135deg, #4d58cf 0%, #715cf1 100%)";
      noteButton.style.pointerEvents = "auto";
    }
  }, 2000);
  return outcome;
}

/**
 * Shows a toast notification when a note is saved.
 */
function showNoteSavedToast(note) {
  // Remove existing toast
  const existing = document.getElementById("ytd-note-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "ytd-note-toast";
  toast.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 6px; color: #5b5bd6;">📝 ${ui("笔记已保存", "Note saved")}</div>
    <div style="font-size: 12px; color: #66708f; margin-bottom: 8px;">${escapeHtmlForContent(note.timestamp)} · ${escapeHtmlForContent(note.videoTitle)}</div>
    <div style="font-size: 13px; line-height: 1.55; color: #171a3d;">"${escapeHtmlForContent(note.text)}"</div>
    <div style="margin-top: 10px; font-size: 11px;">
      <a href="${escapeHtmlForContent(note.timestampedUrl)}" style="color: #5b5bd6; font-weight: 600; text-decoration: none;">🔗 ${ui("复制链接", "Copy link")}</a>
    </div>
  `;

  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
    background: #ffffff;
    border: 1px solid #dde2f2;
    border-radius: 14px;
    padding: 16px 20px;
    max-width: 350px;
    box-shadow: 0 16px 38px rgba(26, 30, 82, 0.22);
    font-family: system-ui, -apple-system, "Roboto", sans-serif;
    animation: ytdSlideIn 0.3s ease;
  `;

  // Add animation keyframes
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ytdSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  // Copy link handler
  toast.querySelector("a").addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(note.timestampedUrl);
      e.target.textContent = ui("✓ 已复制", "✓ Copied!");
    } catch (err) {
      console.error("Copy failed:", err);
    }
  });

  document.body.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.style.animation = "ytdSlideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ============================================================
// VIDEO INFO EXTRACTION
// ============================================================

/**
 * Reads the video title, channel name, and description directly from YouTube's page.
 * These are just sitting in the HTML — we grab them from the DOM elements.
 */
function extractVideoInfo() {
  // The video title is in an h1 element inside the #title container
  const titleElement = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string",
  );

  // The channel name is in the channel info section
  const channelElement = document.querySelector(
    "#channel-name yt-formatted-string a, ytd-channel-name yt-formatted-string a",
  );

  // Video duration from the video element
  const videoElement = document.querySelector("video.html5-main-video");

  // Video description — YouTube has this in a few possible places
  const descriptionElement = document.querySelector(
    "#description-inner, " +
      "ytd-watch-metadata #description yt-attributed-string, " +
      "#description yt-formatted-string, " +
      "ytd-expander#description yt-attributed-string",
  );

  return {
    title: titleElement?.textContent?.trim() || "",
    channelName: channelElement?.textContent?.trim() || "",
    duration: videoElement?.duration || 0,
    description: descriptionElement?.textContent?.trim() || "",
  };
}

// ============================================================
// PROGRESS BAR KEY MOMENTS
// ============================================================

/**
 * Adds colored marker dots to YouTube's video progress bar
 * at the positions of key moments identified by the AI provider.
 *
 * How it works:
 * - YouTube's progress bar is a <div> element with a known class
 * - We calculate each moment's position as a percentage of total duration
 * - We inject small colored <div> elements at those positions
 * - The markers are absolutely positioned on top of the progress bar
 *
 * This is a "bonus feature" — it gives you a visual preview
 * of where the good stuff is in the video.
 */
function highlightKeyMoments(moments, videoDuration) {
  // Disabled: no timeline markers. Chapters live only in the side panel.
  return;
}

// ============================================================
// SEEK TO TIMESTAMP
// ============================================================

/**
 * Jumps the YouTube video to a specific timestamp (in seconds).
 * This is called when the user clicks a timestamp in the side panel.
 *
 * We simply set the video element's .currentTime property,
 * which is the standard HTML5 way to seek in a video.
 */
function seekToTimestamp(seconds) {
  const video = document.querySelector("video.html5-main-video");
  if (!video) {
    console.error("[TranslatorX Content] No video element found for seek");
    return;
  }

  debugLog("[TranslatorX Content] Seeking to:", seconds);
  video.currentTime = seconds;
  // Also play the video if it's paused
  if (video.paused) {
    video.play().catch(() => {}); // Ignore autoplay errors
  }
}

function escapeHtmlForContent(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

// ============================================================
// PAGE NAVIGATION DETECTION
// ============================================================

/**
 * YouTube is a "Single Page Application" (SPA). This means when you
 * click on a new video, the page doesn't fully reload — YouTube
 * dynamically swaps out the content. So our content script stays alive
 * but needs to detect when the video changes.
 *
 * We watch for URL changes using the `yt-navigate-finish` event,
 * which YouTube fires after navigation completes. When that happens,
 * we clean up old markers and re-inject the button.
 */
document.addEventListener("yt-navigate-finish", () => {
  // Clean up old key moment markers when navigating to a new video
  const existingMarkers = document.querySelectorAll(".ytd-key-moment-markers");
  existingMarkers.forEach((m) => m.remove());

  // Remove old buttons (they will be re-injected for the new video)
  document
    .querySelectorAll("#ytd-digest-button")
    .forEach((button) => button.remove());
  ytdDigestButton = null;
  if (digestButtonReconcileTimer) {
    clearTimeout(digestButtonReconcileTimer);
    digestButtonReconcileTimer = null;
  }

  const existingNoteButton = document.getElementById("ytd-note-button");
  if (existingNoteButton) existingNoteButton.remove();

  // Reset note button state
  ytdNoteButton = null;
  clearTimeout(ytdNoteButtonTimer);
  ytdNoteButtonTimer = null;
  if (ytdNoteButtonRetryTimer) {
    clearInterval(ytdNoteButtonRetryTimer);
    ytdNoteButtonRetryTimer = null;
  }

  // Remove any toasts
  const existingToast = document.getElementById("ytd-note-toast");
  if (existingToast) existingToast.remove();

  // Re-inject buttons for the new video (with a small delay for YouTube to render)
  setTimeout(() => {
    scheduleDigestButtonReconciliation(0);
    tryInjectNoteButton();
  }, 500);
});
