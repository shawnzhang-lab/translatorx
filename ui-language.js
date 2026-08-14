/**
 * Shared interface-language state. Product content language controls remain
 * independent: this module changes chrome labels only.
 */
var TX_UI_LANGUAGE = (() => {
  const STORAGE_KEY = "translatorx_ui_language";
  const DEFAULT_LANGUAGE = "zh-CN";
  const SUPPORTED_LANGUAGES = Object.freeze(["zh-CN", "en"]);

  function normalize(value) {
    return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
  }

  function pick(language, chinese, english) {
    return normalize(language) === "en" ? english : chinese;
  }

  async function get() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      return normalize(stored[STORAGE_KEY]);
    } catch (_error) {
      return DEFAULT_LANGUAGE;
    }
  }

  async function set(language) {
    const normalized = normalize(language);
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  function applyToDocument(language, root = document) {
    const normalized = normalize(language);
    root.documentElement.lang = normalized;
    root.documentElement.dataset.uiLanguage = normalized;
    root.querySelectorAll("[data-ui-zh][data-ui-en]").forEach((element) => {
      element.textContent = pick(
        normalized,
        element.dataset.uiZh,
        element.dataset.uiEn,
      );
    });
    root.querySelectorAll("[data-ui-title-zh][data-ui-title-en]").forEach(
      (element) => {
        element.title = pick(
          normalized,
          element.dataset.uiTitleZh,
          element.dataset.uiTitleEn,
        );
      },
    );
    root.querySelectorAll("[data-ui-aria-zh][data-ui-aria-en]").forEach(
      (element) => {
        element.setAttribute(
          "aria-label",
          pick(
            normalized,
            element.dataset.uiAriaZh,
            element.dataset.uiAriaEn,
          ),
        );
      },
    );
    root.querySelectorAll("[data-ui-placeholder-zh][data-ui-placeholder-en]").forEach(
      (element) => {
        element.placeholder = pick(
          normalized,
          element.dataset.uiPlaceholderZh,
          element.dataset.uiPlaceholderEn,
        );
      },
    );
    return normalized;
  }

  async function setupToggle({ button, onChange } = {}) {
    let language = applyToDocument(await get());

    const renderButton = () => {
      if (!button) return;
      const englishInterface = language === "en";
      button.textContent = englishInterface ? "中文" : "English";
      button.setAttribute(
        "aria-label",
        englishInterface ? "切换到中文界面" : "Switch interface to English",
      );
      button.title = englishInterface ? "切换到中文界面" : "Switch to English";
    };

    const commit = (nextLanguage, notify = true) => {
      const normalized = normalize(nextLanguage);
      const changed = normalized !== language;
      language = applyToDocument(normalized);
      renderButton();
      if (notify && changed) onChange?.(language);
      return language;
    };

    renderButton();
    button?.addEventListener("click", async () => {
      const nextLanguage = language === "en" ? "zh-CN" : "en";
      commit(await set(nextLanguage));
    });

    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[STORAGE_KEY]) return;
      commit(changes[STORAGE_KEY].newValue);
    });

    return {
      get language() {
        return language;
      },
      commit,
    };
  }

  return {
    STORAGE_KEY,
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES,
    normalize,
    pick,
    get,
    set,
    applyToDocument,
    setupToggle,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = TX_UI_LANGUAGE;
}
