const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const language = require(path.resolve(__dirname, "..", "ui-language.js"));

test("interface language defaults to Chinese and supports an English switch", () => {
  assert.equal(language.DEFAULT_LANGUAGE, "zh-CN");
  assert.equal(language.normalize("unknown"), "zh-CN");
  assert.equal(language.normalize("en"), "en");
  assert.equal(language.pick("zh-CN", "设置", "Settings"), "设置");
  assert.equal(language.pick("en", "设置", "Settings"), "Settings");
});
