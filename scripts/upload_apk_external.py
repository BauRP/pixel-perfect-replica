#!/usr/bin/env python3
"""Upload a VERIFIED SoundWorld APK to file hosts also used by Nova Gallery.
An external file host cannot compile an Android app or fix a missing runner.
Every returned URL is public to anyone who knows the link.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

CATBOX_MAX = 200 * 1024 * 1024
LITTERBOX_MAX = 1024 * 1024 * 1024

PROVIDERS = (
    ("Catbox", "https://catbox.moe/user/api.php", ("-F", "reqtype=fileupload"), CATBOX_MAX),
    ("Litterbox", "https://litterbox.catbox.moe/resources/internals/api.php",
     ("-F", "reqtype=fileupload", "-F", "time=24h"), LITTERBOX_MAX),
    ("File.io", "https://file.io", (), LITTERBOX_MAX),
)
ALLOWED_HOSTS = {
    "Catbox": {"files.catbox.moe"},
    "Litterbox": {"litter.catbox.moe"},
    "File.io": {"file.io"},
}

def validate_download_url(provider: str, response: str) -> str | None:
    if provider == "File.io":
        try:
            parsed = json.loads(response)
            response = parsed["link"] if parsed.get("success") is True else ""
        except (ValueError, KeyError, TypeError):
            return None
    url = response.strip()
    if len(url) > 2048 or any(ch.isspace() for ch in url):
        return None
    p = urlparse(url)
    if (p.scheme != "https" or p.hostname not in ALLOWED_HOSTS.get(provider, set())
        or p.username or p.password or not p.path.startswith("/")
        or p.path == "/" or p.fragment or p.query):
        return None
    if provider != "File.io" and not p.path.lower().endswith(".apk"):
        return None
    return url

def try_upload(apk: Path, provider: tuple[str, str, tuple[str, ...], int]) -> str | None:
    name, endpoint, extra, maximum = provider
    if apk.stat().st_size > maximum:
        print(f"{name}: APK exceeds supported file size")
        return None
    field = "fileToUpload" if name != "File.io" else "file"
    cmd = (
        "curl", "--silent", "--show-error", "--fail-with-body", "--location",
        "--connect-timeout", "20", "--max-time", "240", "--retry", "2",
        *extra, "-F", f"{field}=@{apk.resolve()}", endpoint,
    )
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                timeout=260, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"{name}: network failure ({type(error).__name__})")
        return None
    if result.returncode != 0:
        print(f"{name}: upload failed (curl exit {result.returncode})")
        return None
    url = validate_download_url(name, result.stdout)
    if not url:
        print(f"{name}: invalid download URL")
    return url

def deliver(apk: Path) -> tuple[str, str] | None:
    if apk.suffix.lower() != ".apk" or apk.is_symlink() or not apk.is_file():
        raise ValueError("No verified APK available for external publication")
    if apk.stat().st_size < 1024 * 1024:
        raise ValueError("APK is abnormally small; refusing upload")
    for provider in PROVIDERS:
        url = try_upload(apk, provider)
        if url:
            return provider[0], url
    return None

def record(provider: str, url: str) -> None:
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as out:
            out.write(f"provider={provider}\ndownload_url={url}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write("## Скачать SoundWorld AR APK\n\n")
            out.write(f"- [Скачать APK с {provider}]({url})\n")
            out.write("- Ссылка на стороннем сайте публичная, APK отладочная.\n")
            if provider == "Litterbox":
                out.write("- Ссылка действует до 24 часов.\n")
            elif provider == "File.io":
                out.write("- File.io может разрешать только одно скачивание.\n")

def main() -> int:
    apk = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/soundworld-ar-debug.apk")
    try:
        result = deliver(apk)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    if result is None:
        print("ERROR: all external APK hosts failed", file=sys.stderr)
        return 1
    provider, url = result
    record(provider, url)
    print(f"Uploaded APK via {provider}: {url}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
