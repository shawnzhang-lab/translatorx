const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const script = process.argv[2];
if (!script) {
  console.error("Usage: node scripts/run-bash.js <script> [arguments...]");
  process.exit(2);
}

const candidates =
  process.platform === "win32"
    ? [
        process.env.GIT_BASH,
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      ].filter(Boolean)
    : ["bash"];

const bash = candidates.find(
  (candidate) => candidate === "bash" || existsSync(candidate),
);

if (!bash) {
  console.error("Git Bash is required to run the release scripts on Windows.");
  process.exit(1);
}

const result = spawnSync(bash, [script, ...process.argv.slice(3)], {
  cwd: process.cwd(),
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
