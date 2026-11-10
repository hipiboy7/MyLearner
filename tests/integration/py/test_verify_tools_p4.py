"""P4 검증 도구가 잡아야 할 것을 잡는가 — check_workflows(워크플로 규칙)·mobile/android/tools/pack.py check(APK 점검)·자바 CSP 와 화면 CSP.

등급 B 도구의 음성 시험(늘 '통과'만 하는 검사기는 쓸모가 없다). 막아야 할 값은 시험 안에서 이어 붙여 만든다(공개 전 점검에 걸리지 않게).
대응: docs/P4_요구사항정의서_Mobile.md FR-403·472·473, NFR-401, docs/P4_설계서_Mobile.md 3.2·3.8·3.9절
"""
import importlib.util
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


CW = load("scripts/check_workflows.py", "ml_check_workflows")
PK = load("mobile/android/tools/pack.py", "ml_android_pack")

GOOD = """name: x
on:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@%s # v7
        with:
          persist-credentials: false
      - run: echo hi
      - uses: actions/upload-artifact@%s # v7
        with:
          name: s
          path: s/
          retention-days: 7
""" % ("a" * 40, "b" * 40)


class WorkflowCheckTest(unittest.TestCase):
    def test_repo_workflows_are_clean(self):
        files = sorted((ROOT / ".github" / "workflows").glob("*.yml"))
        self.assertEqual([f.name for f in files], ["android-emulator.yml", "windows-bundle.yml"])
        for f in files:
            self.assertEqual(CW.check_text(f.name, f.read_text(encoding="utf-8")), [], f.name)

    def test_good_sample_passes(self):
        self.assertEqual(CW.check_text("g.yml", GOOD), [])

    def test_each_rule_catches(self):
        sec = "secr" + "ets."
        cases = {
            "write": GOOD.replace("contents: read", "contents: write"),
            "extra-perm": GOOD.replace("  contents: read\n", "  contents: read\n  packages: read\n"),
            "no-perm": GOOD.replace("permissions:\n  contents: read\n", ""),
            "prt": GOOD.replace("  push:", "  pull_request_target:"),
            "wfrun": GOOD.replace("  push:", "  workflow_run:"),
            "tag": GOOD.replace("@" + "a" * 40, "@v7"),
            "secret": GOOD.replace("echo hi", "echo ${{ %sTOKEN }}" % sec),
            "inject": GOOD.replace("echo hi", "echo ${{ github.event.issue.title }}"),
            "inject-block": GOOD.replace("      - run: echo hi", "      - run: |\n          echo ok\n          echo ${{ github.event.pull_request.body }}"),
            "creds": GOOD.replace("          persist-credentials: false\n", ""),
            "retention": GOOD.replace("          retention-days: 7\n", ""),
            "large": GOOD.replace("ubuntu-24.04", "ubuntu-24.04-16core"),
            "self": GOOD.replace("ubuntu-24.04", "self-hosted"),
        }
        for k, text in cases.items():
            self.assertTrue(CW.check_text("c.yml", text), "검사기가 %s 를 잡지 못했다" % k)

    def test_main_needs_workflows(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(CW.main([d]), 1)


class ApkCheckTest(unittest.TestCase):
    BADGING = ("package: name='io.github.hipiboy7.mylearningplatform' versionCode='400' versionName='0.4.0' platformBuildVersionName='16'\n"
               "minSdkVersion:'26'\ntargetSdkVersion:'36'\napplication-label:'MyLearningPlatform'\n")
    XML = ("E: application\n  A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false\n"
           "  E: activity\n    A: http://schemas.android.com/apk/res/android:exported(0x01010010)=true\n"
           "  E: provider\n    A: http://schemas.android.com/apk/res/android:exported(0x01010010)=false\n")

    def test_clean_release(self):
        self.assertEqual(PK.check(self.BADGING, "package: io.github.hipiboy7.mylearningplatform\n", self.XML, "0.4.0", 400, False), [])

    def test_catches(self):
        perm = "package: x\nuses-permission: name='android.permission." + "INTERNET'\n"
        self.assertTrue(any("권한" in p for p in PK.check(self.BADGING, perm, self.XML, "0.4.0", 400, False)))
        self.assertTrue(any("판" in p for p in PK.check(self.BADGING, "", self.XML, "0.4.1", 401, False)))
        two = self.XML.replace("exported(0x01010010)=false", "exported(0x01010010)=true")
        self.assertTrue(any("exported" in p for p in PK.check(self.BADGING, "", two, "0.4.0", 400, False)))
        dbg = self.XML + "  A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true\n"
        self.assertTrue(any("디버그" in p for p in PK.check(self.BADGING, "", dbg, "0.4.0", 400, False)), "릴리스에 디버그 표시")
        self.assertEqual(PK.check(self.BADGING, "", dbg, "0.4.0", 400, True), [])
        self.assertTrue(any("디버그" in p for p in PK.check(self.BADGING, "", self.XML, "0.4.0", 400, True)), "시험 빌드에 디버그 표시가 없다")
        bk = self.XML.replace("allowBackup(0x01010280)=false", "allowBackup(0x01010280)=true")
        self.assertTrue(any("allowBackup" in p for p in PK.check(self.BADGING, "", bk, "0.4.0", 400, False)))
        self.assertTrue(any("targetSdk" in p for p in PK.check(self.BADGING.replace("'36'", "'35'"), "", self.XML, "0.4.0", 400, False)))

    def test_version_code_rule(self):
        name, code = PK.version()
        major, minor, patch = (int(x) for x in name.split("."))
        self.assertEqual(code, major * 10000 + minor * 100 + patch)


class AndroidStaticTest(unittest.TestCase):
    SRC = ROOT / "mobile" / "android"

    def test_csp_same_as_screen(self):   # FR-403 — 앱이 HTML 응답에 붙이는 CSP = web/index.html 메타 CSP + frame-ancestors
        java = (self.SRC / "src" / "io" / "github" / "hipiboy7" / "mylearningplatform" / "Policy.java").read_text(encoding="utf-8")
        m = re.search(r'static final String CSP = "([^"]*)"\s*\+\s*"([^"]*)";', java)
        csp = m.group(1) + m.group(2)
        meta = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', (ROOT / "web" / "index.html").read_text(encoding="utf-8")).group(1)
        self.assertEqual(csp, meta + "; frame-ancestors 'none'")

    def test_manifest_has_no_permissions(self):   # NFR-401 원본 쪽(빌드한 APK 는 build_android.sh 가 aapt2 로 본다)
        man = (self.SRC / "AndroidManifest.xml").read_text(encoding="utf-8")
        body = re.sub(r"<!--.*?-->", "", man, flags=re.S)
        self.assertNotIn("uses-permission", body)
        self.assertIn('package="io.github.hipiboy7.mylearningplatform"', body)
        self.assertIn('android:allowBackup="false"', body)
        self.assertEqual(body.count('android:exported="true"'), 1)
        names = (self.SRC / "res" / "values" / "strings.xml").read_text(encoding="utf-8")
        self.assertIn('<string name="app_name">MyLearningPlatform</string>', names)

    def test_bridge_names_match_js(self):   # 다리 이름·메서드가 화면 쪽(store/android.js·셸)과 같다
        act = (self.SRC / "src" / "io" / "github" / "hipiboy7" / "mylearningplatform" / "MainActivity.java").read_text(encoding="utf-8")
        self.assertIn('addJavascriptInterface(new Bridge(), "MyLearnerAndroid")', act)
        for m in ("kvGet", "kvPut", "kvDel", "kvList", "saveFile", "shareFile", "openExternal", "setBars", "info"):
            self.assertRegex(act, r"@JavascriptInterface\s+public \w+ %s\(" % m)
        js = (ROOT / "web" / "store" / "android.js").read_text(encoding="utf-8") + (self.SRC / "shell" / "android-shell.js").read_text(encoding="utf-8")
        for m in ("kvGet", "kvPut", "kvDel", "kvList", "saveFile", "shareFile", "openExternal", "setBars", "info"):
            self.assertIn("." + m + "(", js)
        self.assertIn("MyLearner.app.checkDay", act)


if __name__ == "__main__":
    unittest.main()
