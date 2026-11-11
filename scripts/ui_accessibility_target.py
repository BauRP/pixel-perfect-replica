"""Choose a real Android accessibility action instead of a text mention.

The onboarding description also contains the word «Пропустить»; tapping
the first substring occurrence used to tap explanatory text, not the button.
"""
from __future__ import annotations
import re
import sys
import xml.etree.ElementTree as ET


def choose_target(xml: str, needle: str) -> tuple[int, int] | None:
    root = ET.fromstring(xml)
    needle = needle.casefold().strip()
    candidates: list[tuple[tuple[int, int, int], tuple[int, int]]] = []
    for node in root.iter("node"):
        value = " ".join(filter(None, (node.get("text", ""), node.get("content-desc", "")))).casefold().strip()
        if needle not in value:
            continue
        bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
        if len(bounds) != 4 or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
            continue
        # Exact label is more important than inherited clickability;
        # a descriptive paragraph must never win over the actual button.
        exact = int(value == needle)
        clickable = int(node.get("clickable") == "true")
        enabled = int(node.get("enabled") != "false")
        if not enabled:
            continue
        priority = (exact, clickable, -len(value))
        candidates.append((priority, ((bounds[0]+bounds[2])//2, (bounds[1]+bounds[3])//2)))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


if __name__ == "__main__":
    text, desired = open(sys.argv[1], encoding="utf-8").read(), sys.argv[2]
    target = choose_target(text, desired)
    if target is None:
        sys.exit(1)
    print(*target)
