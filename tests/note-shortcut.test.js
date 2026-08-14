const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("plain N is captured on the YouTube page without firing while typing", () => {
  const content = read("content.js");
  assert.match(
    content,
    /document\.addEventListener\("keydown", handleNoteKeyboardShortcut, true\)/,
  );
  assert.match(content, /e\.repeat \|\| e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/);
  assert.match(content, /active\.tagName === "SELECT"/);
  assert.match(content, /active\.closest\?\.\('\[contenteditable="true"\], \[role="textbox"\]'\)/);
  assert.match(content, /e\.stopImmediatePropagation\?\.\(\)/);
});

test("N pressed in the side panel is forwarded to the current YouTube video", () => {
  const content = read("content.js");
  const panel = read("sidepanel.js");
  assert.match(content, /message\.action === "saveCurrentNote"/);
  assert.match(
    panel,
    /document\.addEventListener\("keydown", handlePanelNoteKeyboardShortcut, true\)/,
  );
  assert.match(panel, /const payload = \{ action: "saveCurrentNote" \}/);
  assert.match(panel, /chrome\.tabs\.sendMessage\(youtubeTabId, payload\)/);
  assert.match(panel, /action: "relayToContent",\s*payload/);
});
