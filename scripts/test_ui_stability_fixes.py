"""Regression contracts for four user-reported Android UI/stability issues.

Source contracts are not device execution; CI also runs TypeScript, Vitest and
Gradle to ensure the Android APK still builds.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class UserReportedUiFixes(unittest.TestCase):
    def text(self, file):
        return (ROOT / file).read_text(encoding="utf-8")

    def test_square_player_art_in_every_viewport(self):
        css = self.text("src/styles.css")
        start = css.index("/* Player cover must stay a true square")
        latest = css[start:]
        self.assertIn(".sw-player .sw-player-cover", latest)
        self.assertIn("aspect-ratio: 1 / 1;", latest)
        self.assertIn("height: auto;", latest)
        self.assertIn("max-height: none;", latest)

    def test_selected_tab_uses_line_not_icon_pill(self):
        source = self.text("src/components/sw/AppShell.tsx")
        self.assertIn("absolute left-1/2 top-0 h-[2px]", source)
        self.assertIn("aria-current={on", source)
        self.assertNotIn('on && "bg-primary/15"', source)

    def test_help_is_white_question_in_transparent_circle_with_reliable_click(self):
        source = self.text("src/components/sw/ui.tsx")
        self.assertIn("aria-expanded={visible}", source)
        self.assertIn("onClick={toggle}", source)
        self.assertIn('role="dialog"', source)
        self.assertIn("createPortal(", source)
        self.assertIn('background: "transparent"', source)
        self.assertIn('color: "#ffffff"', source)
        self.assertIn('border: "1.5px solid #ffffff"', source)
        self.assertIn('}}>?</span>', source)
        self.assertNotIn("<PopoverTrigger", source)

    def test_sliders_persist_on_commit_not_each_movement(self):
        source = self.text("src/routes/studio.index.tsx")
        for field in ("mood", "speed"):
            self.assertIn(f'set("{field}", v ?? 0)', source)
            self.assertIn(f'onValueCommit={{([v]) => set("{field}", v ?? 0)}}', source)
            self.assertNotIn(f'onValueChange={{([v]) => set("{field}", v ?? 0)}}', source)

    def test_player_mic_ui_limits_native_event_renders(self):
        source = self.text("src/routes/index.tsx")
        self.assertIn("if(now-lastMicUiAt<1000)return;", source)

if __name__ == "__main__":
    unittest.main()
