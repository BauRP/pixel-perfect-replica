#!/usr/bin/env bash
# GitHub Releases only: runner-local APK bytes never use Actions artifact storage.
set -euo pipefail

: "${GH_TOKEN:?GitHub token is required for APK publication}"
: "${GITHUB_REPOSITORY:?GitHub repository is required}"
: "${GITHUB_RUN_ID:?GitHub build identifier is required}"
: "${GITHUB_RUN_ATTEMPT:?GitHub build attempt is required}"
: "${GITHUB_SHA:?Source commit is required}"
: "${GITHUB_STEP_SUMMARY:?Build summary destination is required}"
export GH_REPO="$GITHUB_REPOSITORY"

apk="output/soundworld-ar-debug.apk"
checksum="${apk}.sha256"
test -s "$apk"
test -s "$checksum"
(cd output && sha256sum --check soundworld-ar-debug.apk.sha256)
tag="soundworld-ar-build-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
title="SoundWorld AR — diagnostic APK #${GITHUB_RUN_NUMBER:-$GITHUB_RUN_ID}"
notes="Automatic Android 12+ debug APK from commit ${GITHUB_SHA}. Device startup has not been verified. Offline Fermata music AI is not connected. A different debug signature may require uninstalling the previous version. Private repository: GitHub access is required to download."

# Create prerelease with both files, then verify the real uploaded assets.
# GitHub's release-by-tag API returns 404 for draft releases.
published_ok=0
cleanup_incomplete_release() {
  if [[ "$published_ok" != "1" ]]; then
    gh release delete "$tag" --yes >/dev/null 2>&1 || true
  fi
}
trap cleanup_incomplete_release EXIT

gh release create "$tag" "$apk" "$checksum" \
  --target "$GITHUB_SHA" --title "$title" --notes "$notes" \
  --prerelease --latest=false

verify_assets() {
  gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${tag}" | \
    python3 -c '
import json, sys
from pathlib import Path
from urllib.parse import quote
release = json.load(sys.stdin)
repo, tag, expected_draft = sys.argv[1:]
if release.get("tag_name") != tag or release.get("draft") != (expected_draft == "true"):
    raise SystemExit("GitHub did not confirm the expected release publication state")
assets = {a.get("name"): a for a in release.get("assets", [])}
for path in (Path("output/soundworld-ar-debug.apk"), Path("output/soundworld-ar-debug.apk.sha256")):
    asset = assets.get(path.name, {})
    if asset.get("state") != "uploaded" or asset.get("size") != path.stat().st_size:
        raise SystemExit(f"GitHub did not confirm complete uploaded bytes for {path.name}")
url = assets["soundworld-ar-debug.apk"].get("browser_download_url", "")
expected = f"https://github.com/{repo}/releases/download/{quote(tag, safe=chr(45))}/soundworld-ar-debug.apk"
if url != expected:
    raise SystemExit("GitHub returned an invalid direct APK download URL")
print(url)
' "$GITHUB_REPOSITORY" "$tag" "$1"
}

download_url="$(verify_assets false)"
published_ok=1
trap - EXIT
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "download_url=$download_url" >> "$GITHUB_OUTPUT"
fi
{
  echo "## Download APK"
  echo
  echo "**APK BUILD:** Successful."
  echo "**APK PUBLISHING:** Successful."
  echo "[Download APK](${download_url})"
  echo
  echo "Android 12+ diagnostic debug APK; device startup not verified."
  echo "Private repository: sign in to GitHub with repository access to download."
  echo "**AUTOMATIC PUBLISHING:** Every successful run of this workflow publishes its own Release."
} >> "$GITHUB_STEP_SUMMARY"
echo "Completed APK: $download_url"