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

    def test_android14_aosp_onboarding_matches_real_webview_viewport(self):
        # Reproduces CI #208: DOM button was measured, while Android 14's
        # accessibility tree omitted the WebView entirely. Native geometry
        # must be present; do not guess the location from phone dimensions.
        dom = marker(
            rect={"left":280,"right":377,"top":24,"bottom":72},
            dpr=2.75,w=393,h=758,
        )
        self.assertIsNone(measured_skip("<hierarchy/>",dom))
        real = 'I/SoundWorldGeometry SW_NATIVE_WEBVIEW {"left":0,"top":80,"right":1080,"bottom":2164}'
        self.assertEqual(measured_skip("<hierarchy/>",real+"\n"+dom),(903,212))

    def test_android14_native_geometry_when_accessibility_hides_webview(self):
        actual = 'I/SoundWorldGeometry SW_NATIVE_WEBVIEW {"left":0,"top":76,"right":1080,"bottom":2225}'
        self.assertEqual(measured_skip('<hierarchy/>', actual+"\n"+marker(h=782)), (914,189))

    def test_native_view_wins_over_stale_accessibility_view(self):
        actual = 'I/SoundWorldGeometry SW_NATIVE_WEBVIEW {"left":0,"top":80,"right":1080,"bottom":2229}'
        self.assertEqual(measured_skip(xml("[0,83][1080,2232]"),actual+"\n"+marker(h=782)), (914,193))

    def test_invalid_native_geometry_cannot_trick_android_tap(self):
        stale='SW_NATIVE_WEBVIEW {"left":0,"top":999,"right":120,"bottom":1150}'
        self.assertIsNone(measured_skip('<hierarchy/>',stale+"\n"+marker(h=782)))

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
