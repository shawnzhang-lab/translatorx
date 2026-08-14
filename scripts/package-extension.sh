#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
check_script="$script_dir/check-release.sh"
dist_dir="$repo_root/dist"

if command -v zip >/dev/null 2>&1; then
  archive_tool="zip"
elif [[ -x /c/Windows/System32/tar.exe ]]; then
  archive_tool="windows_tar"
else
  printf 'Packaging failed: zip or Windows tar.exe is required\n' >&2
  exit 1
fi

release_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && release_files+=("$file")
done < <("$check_script" --print-files)

if ((${#release_files[@]} == 0)); then
  printf 'Packaging failed: release allowlist is empty\n' >&2
  exit 1
fi

version="$(node -e 'const m=require(process.argv[1]); process.stdout.write(m.version)' "$repo_root/manifest.json")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  printf 'Packaging failed: unsafe manifest version: %s\n' "$version" >&2
  exit 1
fi

mkdir -p "$dist_dir"
temporary_dir="$(mktemp -d "$dist_dir/.translatorx-package.XXXXXX")"
temporary_zip="$temporary_dir/translatorx.zip"
output_zip="$dist_dir/translatorx-v$version.zip"

cleanup() {
  if [[ -f "$temporary_zip" ]]; then
    rm -f "$temporary_zip"
  fi
  if [[ -d "$temporary_dir" ]]; then
    rmdir "$temporary_dir" 2>/dev/null || true
  fi
}
trap cleanup EXIT

(
  cd "$repo_root"
  if [[ "$archive_tool" == "zip" ]]; then
    # Exclude platform-specific extra attributes so identical source files
    # produce the same archive checksum across repeated local builds.
    zip -X -q "$temporary_zip" "${release_files[@]}"
  else
    # Windows ships bsdtar with ZIP creation support. The explicit allowlist
    # keeps the Windows fallback just as narrow as the regular zip path.
    /c/Windows/System32/tar.exe -a -c -f "$temporary_zip" "${release_files[@]}"
  fi
)

if [[ "$archive_tool" == "zip" ]]; then
  archive_entries=(unzip -Z1 "$temporary_zip")
else
  archive_entries=(/c/Windows/System32/tar.exe -tf "$temporary_zip")
fi

if "${archive_entries[@]}" | grep -En '(^|/)(config\.js|\.DS_Store|\.git)(/|$)' >&2; then
  printf 'Packaging failed: a forbidden private path entered the ZIP\n' >&2
  exit 1
fi

mv -f "$temporary_zip" "$output_zip"
rmdir "$temporary_dir"
trap - EXIT

if command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "$output_zip" | awk '{print $1}')"
else
  checksum="$(sha256sum "$output_zip" | awk '{print $1}')"
fi
printf 'Created %s\n' "$output_zip"
printf 'SHA-256: %s\n' "$checksum"
