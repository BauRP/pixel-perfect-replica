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

    def test_help_is_small_white_question_with_mobile_dialog(self):
        source = self.text("src/components/sw/ui.tsx")
        self.assertIn("aria-expanded={open}",source)
        self.assertIn("onTouchEnd={event =>",source)
        self.assertIn("onClick={() => {",source)
        self.assertIn('aria-modal="true"',source)
        self.assertIn("createPortal(",source)
        self.assertIn('width:22,height:22',source)
        self.assertIn('width:44,height:44',source)
        self.assertIn('background:"transparent",color:"#ffffff"',source)
        self.assertIn('border:"1.5px solid #ffffff"',source)
        self.assertIn('}}>?</span>',source)
        self.assertNotIn('addEventListener("scroll"',source)
        self.assertNotIn("<PopoverTrigger",source)

    def test_each_studio_setting_has_real_help_and_no_extra_features(self):
        studio = self.text("src/routes/studio.index.tsx")
        self.assertEqual(studio.count("<Item n="),11)
        self.assertEqual(studio.count('help="'),11)
        for value in ("Слабо:","Средне:","Сильно:","Плавно:","Быстро:",
                      "Автоматически:","Привычная:","Экспериментальная:",
                      "Только управление:","Слабое:","Активное:"):
            self.assertIn(value,studio)

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
