#!/usr/bin/env python3
"""Publish a verified Codemagic APK to PRIVATE GitHub Releases.

Requires encrypted Codemagic environment secret GITHUB_RELEASE_TOKEN with
Contents: Read and write permission on BauRP/pixel-perfect-replica only.
Missing credentials or incomplete uploads fail publication explicitly.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

REPOSITORY = "BauRP/pixel-perfect-replica"
APK = Path("output/soundworld-ar-debug.apk")
CHECKSUM = Path("output/soundworld-ar-debug.apk.sha256")
API = f"https://api.github.com/repos/{REPOSITORY}"
LATEST_APK_URL = f"https://github.com/{REPOSITORY}/releases/latest/download/{APK.name}"


def request_json(url: str, token: str, *, method: str = "GET", payload=None):
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(payload).encode("utf-8")
    req = Request(url, data=payload, method=method, headers=headers)
    with urlopen(req, timeout=60) as response:
        return json.load(response)


def upload_asset(url: str, token: str, path: Path):
    data = path.read_bytes()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/vnd.android.package-archive" if path.suffix == ".apk" else "text/plain",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    req = Request(url + "?name=" + quote(path.name), data=data,
                  method="POST", headers=headers)
    with urlopen(req, timeout=180) as response:
        result = json.load(response)
    if result.get("name") != path.name or result.get("size") != len(data):
        raise RuntimeError(f"GitHub did not confirm uploaded asset {path.name}")
    return result


def main() -> int:
    token = os.environ.get("GITHUB_RELEASE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Configure encrypted GITHUB_RELEASE_TOKEN in Codemagic with repository Contents write access")
    if os.environ.get("CM_REPO_SLUG") != REPOSITORY:
        raise RuntimeError("Refusing to publish outside the authorized SoundWorld repository")
    if os.environ.get("CM_BRANCH") != "main":
        raise RuntimeError("Refusing to publish APK from a non-main branch")
    sha = os.environ.get("CM_COMMIT", "")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise RuntimeError("Codemagic source commit is missing or invalid")
    build_id = os.environ.get("CM_BUILD_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,90}", build_id):
        raise RuntimeError("Codemagic build identifier is missing or invalid")
    if not APK.is_file() or APK.is_symlink() or APK.stat().st_size < 1000000:
        raise RuntimeError("Verified APK does not exist or is too small")
    if not CHECKSUM.is_file():
        raise RuntimeError("APK checksum file is missing")
    digest = hashlib.sha256(APK.read_bytes()).hexdigest()
    if CHECKSUM.read_text(encoding="utf-8").strip() != f"{digest}  {APK.name}":
        raise RuntimeError("APK checksum mismatch; refusing GitHub release")

    # Every completed build gets a Release; only current main updates latest.
    main_branch = request_json(f"{API}/branches/main", token)
    main_sha = main_branch.get("commit", {}).get("sha")
    is_current = main_sha == sha

    tag = f"soundworld-codemagic-{build_id}"
    release_url = f"{API}/releases"
    payload = {
        "tag_name": tag,
        "target_commitish": sha,
        "name": f"SoundWorld AR - Codemagic {build_id}",
        "body": f"SoundWorld AR diagnostic Android debug APK, built from main commit {sha}. "
                "Android device startup and real offline Fermata model not verified.",
        # Publish only after both APK and SHA256 are verified and uploaded.
        "draft": True,
        "prerelease": False,
    }
    try:
        release = request_json(release_url, token, method="POST", payload=payload)
    except HTTPError as error:
        if error.code != 422:
            raise
        release = request_json(f"{release_url}/tags/{quote(tag)}", token)
    assets = {item.get("name"): item for item in release.get("assets", [])}
    upload_url = release["upload_url"].split("{")[0]
    for path in (APK, CHECKSUM):
        if path.name not in assets:
            assets[path.name] = upload_asset(upload_url, token, path)
    latest = request_json(f"{release_url}/tags/{quote(tag)}", token)
    final_assets = {item.get("name"): item for item in latest.get("assets", [])}
    if any(x.name not in final_assets or final_assets[x.name].get("state") != "uploaded"
           or final_assets[x.name].get("size") != x.stat().st_size
           for x in (APK, CHECKSUM)):
        raise RuntimeError("Release exists but verified APK and checksum are incomplete")
    apk_url = final_assets[APK.name]["browser_download_url"]
    if apk_url != f"https://github.com/{REPOSITORY}/releases/download/{tag}/{APK.name}":
        raise RuntimeError("Unexpected GitHub APK URL")
    # GitHub's /releases/latest/download/... always targets the newest
    # successfully verified APK. Avoid changing latest while assets are missing.
    published = request_json(
        f"{release_url}/{release['id']}", token,
        method="PATCH",
        payload={"draft": False, "prerelease": False, "make_latest": "true" if is_current else "false"},
    )
    if published.get("draft") or published.get("prerelease") or published.get("tag_name") != tag:
        raise RuntimeError("GitHub did not confirm publication of the verified release")
    print("SoundWorld verified APK direct download:", apk_url)
    if is_current:
        print("SoundWorld LATEST APK permanent download:", LATEST_APK_URL)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never include token values or raw response bodies in error messages.
        detail = f"HTTP {error.code}: {error.reason}" if isinstance(error, HTTPError) else str(error)
        print(f"GitHub Releases upload failed: {type(error).__name__}: {detail}", file=sys.stderr)
        sys.exit(1)
