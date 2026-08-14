const form = document.getElementById("settingsForm");
const aiApiKeyInput = document.getElementById("aiApiKey");
const supadataApiKeyInput = document.getElementById("supadataApiKey");
const saveStatus = document.getElementById("saveStatus");
const dataStatus = document.getElementById("dataStatus");
let uiLanguage = "zh-CN";

document.addEventListener("DOMContentLoaded", initializeOptions);
form.addEventListener("submit", saveSettings);
document
  .getElementById("clearCacheBtn")
  .addEventListener("click", clearCachedDigests);
document
  .getElementById("clearNotesBtn")
  .addEventListener("click", clearNotes);
document.getElementById("resetBtn").addEventListener("click", resetAllData);

function ui(chinese, english) {
  return TX_UI_LANGUAGE.pick(uiLanguage, chinese, english);
}

async function initializeOptions() {
  const controller = await TX_UI_LANGUAGE.setupToggle({
    button: document.getElementById("uiLanguageToggle"),
    onChange(language) {
      uiLanguage = language;
      document.title = ui("TranslatorX 设置", "TranslatorX Settings");
      saveStatus.textContent = "";
      dataStatus.textContent = "";
    },
  });
  uiLanguage = controller.language;
  document.title = ui("TranslatorX 设置", "TranslatorX Settings");
  await loadSettings();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
  const migration = YTD_SETTINGS.migrateLegacyCustom(
    stored[YTD_SETTINGS.STORAGE_KEY],
  );
  const settings = migration.settings;

  aiApiKeyInput.value = settings.aiApiKey;
  supadataApiKeyInput.value = settings.supadataApiKey;
  if (migration.migrated) {
    await chrome.storage.local.set({
      [YTD_SETTINGS.STORAGE_KEY]: settings,
    });
    saveStatus.textContent = ui(
      "自定义服务商设置已安全移除。Supadata Key 已保留，但 AI Key 已清除，请填写 DeepSeek API Key 后继续。",
      "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter a DeepSeek API key to continue.",
    );
  }
}

async function saveSettings(event) {
  event.preventDefault();
  saveStatus.textContent = ui("正在保存…", "Saving…");

  try {
    const settings = YTD_SETTINGS.normalize({
      aiApiKey: aiApiKeyInput.value,
      supadataApiKey: supadataApiKeyInput.value,
    });

    if (!settings.aiApiKey) {
      throw new Error(ui("请填写 DeepSeek API Key。", "Add a DeepSeek API key."));
    }

    await chrome.storage.local.set({
      [YTD_SETTINGS.STORAGE_KEY]: settings,
    });

    saveStatus.textContent = ui(
      "已保存。重新打开 TranslatorX 后即可使用。",
      "Saved. Reopen TranslatorX to use these settings.",
    );
  } catch (error) {
    saveStatus.textContent = error.message;
  }
}

async function clearCachedDigests() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith("digest_"));
  if (keys.length) await chrome.storage.local.remove(keys);
  dataStatus.textContent = ui(
    `已清除 ${keys.length} 份摘要缓存。`,
    `Cleared ${keys.length} cached digest${keys.length === 1 ? "" : "s"}.`,
  );
}

async function clearNotes() {
  await chrome.storage.local.remove("ytd_notes");
  dataStatus.textContent = ui("已删除全部笔记。", "Deleted all saved notes.");
}

async function resetAllData() {
  const confirmed = window.confirm(
    ui(
      "是否从当前 Chrome 配置中删除 API Key、摘要缓存、翻译和笔记？",
      "Delete API keys, cached digests, translations, and saved notes from this Chrome profile?",
    ),
  );
  if (!confirmed) return;

  await chrome.storage.local.clear();
  await loadSettings();
  dataStatus.textContent = ui(
    "所有 TranslatorX 数据均已删除。",
    "All TranslatorX data was deleted.",
  );
}
