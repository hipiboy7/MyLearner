"""등급 A — JS web/core/constants.js 와 Python mylearner/constants.py 의 SHARED 가 같다(FR-202)."""
import json
import re
import unittest
from pathlib import Path

from mylearner import constants as K

ROOT = Path(__file__).resolve().parents[3]


def js_shared():
    text = (ROOT / "web" / "core" / "constants.js").read_text(encoding="utf-8")
    m = re.search(r"/\* SHARED-BEGIN \*/(.*?)/\* SHARED-END \*/", text, re.S)
    return json.loads(m.group(1))


class SharedConstantsTest(unittest.TestCase):
    def test_same_as_js(self):
        self.assertEqual(js_shared(), K.SHARED)

    def test_aliases_and_patterns(self):
        self.assertEqual(K.COURSE_FORMAT, "mylearner-course")
        self.assertEqual(K.MWL_COURSE_ID, "mwl")
        for key in ("COURSE_ID_RE", "ITEM_ID_RE"):
            re.compile(K.SHARED[key])
        self.assertTrue(re.match(K.SHARED["ITEM_ID_RE"], "A1-1-c01"))
        self.assertTrue(re.match(K.SHARED["COURSE_ID_RE"], K.SHARED["MWL_NOTES_ID"]))
        self.assertRegex("MiddlewareLearner@" + K.MWL_COMMIT, K.REF_RE)


if __name__ == "__main__":
    unittest.main()
