import json
import unittest
from scripts.ui_measured_onboarding import measured_skip

def xml(bounds="[0,83][1080,2148]"):
    return f'<hierarchy><node class="android.webkit.WebView" bounds="{bounds}" /></hierarchy>'

def marker(rect=None, *, path="/onboarding", completed=False, dpr=2.75, w=393, h=751):
    rect = rect or {"left":300, "right":365, "top":22, "bottom":60}
    return "I/Capacitor SW_NAV_GEOMETRY " + json.dumps({
        "path":path, "completed":completed, "onboardingSkip":rect,
        "dpr":dpr, "vw":w, "vh":h,
    })

class MeasuredOnboardingTest(unittest.TestCase):
    def test_measured_button_ignores_nonclickable_paragraph(self):
        self.assertEqual(measured_skip(xml(), marker()), (914,196))

    def test_last_valid_marker_wins(self):
        logs=marker({"left":100,"right":140,"top":20,"bottom":50})+"\n"+marker()
        self.assertEqual(measured_skip(xml(),logs),(914,196))

    def test_rejects_stale_route_and_completed(self):
        self.assertIsNone(measured_skip(xml(), marker(path="/", completed=True)))
        self.assertIsNone(measured_skip(xml(), marker(completed=True)))

    def test_rejects_inconsistent_viewport(self):
        self.assertIsNone(measured_skip(xml(),marker(dpr=1)))
        self.assertIsNone(measured_skip(xml(),marker(rect={"left":450,"right":470,"top":20,"bottom":60})))

    def test_rejects_missing_real_geometry(self):
        self.assertIsNone(measured_skip(xml(), "SW_NAV_GEOMETRY {}"))
        self.assertIsNone(measured_skip(xml(),marker(rect={"left":20,"right":-10,"top":0,"bottom":30})))
        self.assertIsNone(measured_skip("<invalid",marker()))

if __name__ == "__main__":
    unittest.main()
