"""Tap the REAL React onboarding button using its measured DOM geometry.

Old Android WebViews expose only a WebView title to UIAutomator, or a paragraph
that mentions «Пропустить». Matching that text may tap the paragraph rather
than the button. The app emits a geometry marker after React commits.
This script validates the marker and maps CSS coordinates to the physical
WebView rectangle. It does not bypass onboarding or invent a successful tap.
"""
import json
import math
import re
import sys
import xml.etree.ElementTree as ET


def measured_skip(xml: str, log: str) -> tuple[int, int] | None:
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return None
    bounds = []
    for node in root.iter("node"):
        if node.get("class") != "android.webkit.WebView":
            continue
        found = [int(v) for v in re.findall(r"\d+", node.get("bounds", ""))]
        if len(found) == 4 and found[2] > found[0] and found[3] > found[1]:
            bounds.append(found)
    if not bounds:
        return None
    # WebView itself and nested accessibility root commonly share bounds.
    left, top, right, bottom = max(bounds, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    marker = "SW_NAV_GEOMETRY "
    candidates = []
    for line in log.splitlines():
        if marker not in line:
            continue
        try:
            d = json.loads(line.split(marker, 1)[1].strip())
        except (ValueError, TypeError):
            continue
        if d.get("path") != "/onboarding" or d.get("completed") is not False:
            continue
        rect = d.get("onboardingSkip")
        dpr = d.get("dpr")
        w, h = d.get("vw"), d.get("vh")
        if not isinstance(rect, dict) or not all(
            isinstance(v, (int, float)) and math.isfinite(v)
            for v in (rect.get("left"), rect.get("right"), rect.get("top"), rect.get("bottom"), dpr, w, h)
        ):
            continue
        if not (0 < rect["right"] - rect["left"] <= w and
                0 < rect["bottom"] - rect["top"] <= h and
                0 <= rect["left"] < rect["right"] <= w and
                0 <= rect["top"] < rect["bottom"] <= h and
                1 <= dpr <= 8 and 100 <= w <= 1500 and 100 <= h <= 3000):
            continue
        if abs((right-left) / w - dpr) > .35 or abs((bottom-top) / h - dpr) > .35:
            continue
        x = round(left + (rect["left"] + rect["right"]) * dpr / 2)
        y = round(top + (rect["top"] + rect["bottom"]) * dpr / 2)
        if not (left < x < right and top < y < bottom):
            continue
        candidates.append((x, y))
    return candidates[-1] if candidates else None


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        xml = f.read()
    tap = measured_skip(xml, sys.stdin.read())
    if tap is None:
        sys.exit(1)
    print(*tap)
