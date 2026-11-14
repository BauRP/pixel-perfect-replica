#!/usr/bin/env python3
"""Fail-closed last-mounted-route check from actual React WebView logcat markers.

The Android UI test must never pass from a stale historical route marker,
including markers from before a delayed navigation or system overlay.
"""
import json
import sys

MARKER = "SW_NAV_GEOMETRY "


def latest_mounted_route(lines):
    latest = None
    for line in lines:
        if MARKER not in line:
            continue
        try:
            record = json.loads(line.split(MARKER, 1)[1].strip())
        except (ValueError, TypeError):
            continue
        if isinstance(record, dict):
            latest = record
    return latest


def visible_route(lines, path, heading):
    latest = latest_mounted_route(lines)
    if not latest or latest.get("path") != path:
        return False
    # An onboarding screen marked completed is awaiting navigation; never
    # retry tapping the now inactive skip button.
    if path == "/onboarding" and latest.get("completed") is True:
        return False
    actual = latest.get("heading")
    return bool(
        latest.get("root") and latest.get("shell")
        and isinstance(actual, str)
        and isinstance(path, str)
        and isinstance(heading, str)
        and heading.casefold() in actual.casefold()
    )


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: ui_route_status.py ROUTE HEADING")
    lines = sys.stdin
    latest = latest_mounted_route(lines)
    if latest and latest.get("path") == sys.argv[1] and (
        sys.argv[1] != "/onboarding" or latest.get("completed") is not True
    ) and latest.get("root") and latest.get("shell") and (
        isinstance(latest.get("heading"), str) and
        sys.argv[2].casefold() in latest["heading"].casefold()
    ):
        print("DOM_ROUTE_OK", sys.argv[1],
              "heading=", latest.get("heading"), "nav=", latest.get("nav"))
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
