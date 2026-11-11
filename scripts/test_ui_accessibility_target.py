import unittest
from scripts.ui_accessibility_target import choose_target

class AccessibilityTargetTest(unittest.TestCase):
    def test_exact_button_beats_explanation(self):
        xml = """<hierarchy>
        <node text="«Пропустить» — значит, нравятся все жанры" bounds="[0,400][800,540]" clickable="false" enabled="true"/>
        <node text="Пропустить" bounds="[700,90][1010,200]" clickable="true" enabled="true"/>
        </hierarchy>"""
        self.assertEqual(choose_target(xml, "Пропустить"), (855,145))

    def test_disabled_exact_does_not_win(self):
        xml = """<hierarchy>
        <node text="Пропустить" bounds="[0,0][100,100]" clickable="true" enabled="false"/>
        <node text="Пропустить" bounds="[100,100][300,200]" clickable="true" enabled="true"/>
        </hierarchy>"""
        self.assertEqual(choose_target(xml, "Пропустить"), (200,150))

    def test_missing_or_invalid_geometry(self):
        self.assertIsNone(choose_target('<hierarchy><node text="Пропустить" bounds=""/></hierarchy>', "Пропустить"))
        self.assertIsNone(choose_target('<hierarchy/>', "Пропустить"))

    def test_casefold(self):
        xml='<hierarchy><node text="СТУДИЯ" bounds="[50,50][150,150]" clickable="true"/></hierarchy>'
        self.assertEqual(choose_target(xml,"Студия"), (100,100))

if __name__ == "__main__":
    unittest.main()
