import json
import unittest
from scripts.ui_route_status import latest_mounted_route, visible_route

def marker(path, heading, completed=False, root=True, shell=True):
    return ("I/Capacitor SW_NAV_GEOMETRY " +
            json.dumps({"path":path,"heading":heading,"completed":completed,
                        "root":{"top":0} if root else None,
                        "shell":{"top":0} if shell else None}) + "\n")

class MountedRouteTests(unittest.TestCase):
    def test_latest_route_wins_over_historical_screen(self):
        log = marker("/","Живая музыка") + marker("/onboarding","Музыкальные вкусы")
        self.assertFalse(visible_route(log.splitlines(),"/","Живая музыка"))
        self.assertTrue(visible_route(log.splitlines(),"/onboarding","Музыкальные вкусы"))
    def test_completed_onboarding_cannot_be_tapped_again(self):
        self.assertFalse(visible_route(marker("/onboarding","Музыкальные вкусы",True).splitlines(),
                                       "/onboarding","Музыкальные вкусы"))
    def test_invalid_or_unmounted_is_not_success(self):
        log = marker("/","Живая музыка") + "SW_NAV_GEOMETRY bad-json\n" + marker("/", "Живая музыка",root=False)
        self.assertFalse(visible_route(log.splitlines(),"/","Живая музыка"))
        self.assertIsNone(latest_mounted_route(["SW_NAV_GEOMETRY bad-json"]))
        self.assertFalse(visible_route(marker("/","Живая музыка",shell=False).splitlines(),"/","Живая музыка"))
    def test_valid_real_route(self):
        self.assertTrue(visible_route(marker("/","Живая музыка").splitlines(),"/","живая МУЗЫКА"))

if __name__ == "__main__":
    unittest.main()
