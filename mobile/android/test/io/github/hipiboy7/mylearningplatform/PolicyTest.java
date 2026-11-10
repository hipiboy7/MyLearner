package io.github.hipiboy7.mylearningplatform;

/**
 * Policy 의 규칙 시험 — 외부 시험 도구(JUnit 등) 없이 main 하나로 돈다. scripts/build_android.sh 가 빌드마다 먼저 돌리고, 하나라도 틀리면 멈춘다.
 * MWL test/.../PolicyTest.java(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다 — 파일 이름(.zip·.jsonl)·형식·CSP. 문서: docs/P4_설계서_Mobile.md 3.2·3.10절
 */
public final class PolicyTest {
    private static int pass;
    private static int fail;

    private static void eq(String name, Object got, Object want) {
        if (want == null ? got == null : want.equals(got)) {
            pass++;
        } else {
            fail++;
            System.out.println("FAIL " + name + ": got " + got + ", want " + want);
        }
    }

    public static void main(String[] args) {
        String o = Policy.ORIGIN;

        // 이 앱의 주소
        eq("isApp:index", Policy.isApp(o + "/index.html#/today"), true);
        eq("isApp:root", Policy.isApp(o + "/"), true);
        eq("isApp:port443", Policy.isApp("https://appassets.androidplatform.net:443/index.html"), true);
        eq("isApp:http", Policy.isApp("http://appassets.androidplatform.net/index.html"), false);
        eq("isApp:otherPort", Policy.isApp("https://appassets.androidplatform.net:8443/index.html"), false);
        eq("isApp:lookalike", Policy.isApp("https://appassets.androidplatform.net.example.com/"), false);
        // 계정 정보가 붙은 주소 — 글자 그대로 적으면 공개 전 점검이 메일 주소로 읽는다
        eq("isApp:userinfo", Policy.isApp("https://x" + "@" + Policy.HOST + "/"), false);
        eq("isApp:null", Policy.isApp(null), false);
        eq("isApp:garbage", Policy.isApp("::::"), false);

        // 화면이 옮겨 가려는 주소
        eq("nav:inApp", Policy.navigation(o + "/index.html#/stats"), Policy.Nav.IN_APP);
        eq("nav:https", Policy.navigation("https://example.com/manual"), Policy.Nav.EXTERNAL);
        eq("nav:http", Policy.navigation("http://example.com/"), Policy.Nav.EXTERNAL);
        eq("nav:HTTPS-upper", Policy.navigation("HTTPS://Example.com/"), Policy.Nav.EXTERNAL);
        eq("nav:intent", Policy.navigation("intent://scan/#Intent;scheme=zxing;end"), Policy.Nav.BLOCK);
        eq("nav:file", Policy.navigation("file:///sdcard/Download/x.zip"), Policy.Nav.BLOCK);
        eq("nav:content", Policy.navigation("content://media/external/file/1"), Policy.Nav.BLOCK);
        eq("nav:javascript", Policy.navigation("javascript:alert(1)"), Policy.Nav.BLOCK);
        eq("nav:blob", Policy.navigation("blob:" + o + "/1234"), Policy.Nav.BLOCK);
        eq("nav:data", Policy.navigation("data:text/html,hi"), Policy.Nav.BLOCK);
        eq("nav:tel", Policy.navigation("tel:0212345678"), Policy.Nav.BLOCK);
        eq("nav:userinfo", Policy.navigation("https://user" + "@" + "example.com/"), Policy.Nav.BLOCK);
        eq("nav:nohost", Policy.navigation("https:///x"), Policy.Nav.BLOCK);
        eq("nav:null", Policy.navigation(null), Policy.Nav.BLOCK);

        // 자산 경로
        eq("asset:index", Policy.assetPath(o + "/index.html#/today"), "web/index.html");
        eq("asset:root", Policy.assetPath(o + "/"), "web/index.html");
        eq("asset:empty", Policy.assetPath(o), "web/index.html");
        eq("asset:course", Policy.assetPath(o + "/data/courses/mwl.js"), "web/data/courses/mwl.js");
        eq("asset:query", Policy.assetPath(o + "/app/main.js?v=1"), "web/app/main.js");
        eq("asset:dotdot", Policy.assetPath(o + "/../AndroidManifest.xml"), null);
        eq("asset:dotdotMid", Policy.assetPath(o + "/data/../app/main.js"), null);
        eq("asset:encoded", Policy.assetPath(o + "/%2e%2e/x"), null);
        eq("asset:encodedSlash", Policy.assetPath(o + "/data%2fx.js"), null);
        eq("asset:space", Policy.assetPath(o + "/a%20b.js"), null);
        eq("asset:backslash", Policy.assetPath(o + "/a\\b.js"), null);
        eq("asset:double", Policy.assetPath(o + "//app.js"), null);
        eq("asset:trailing", Policy.assetPath(o + "/data/"), null);
        eq("asset:api", Policy.assetPath(o + "/api/health"), "web/api/health");
        eq("asset:other", Policy.assetPath("https://example.com/index.html"), null);

        // MIME
        eq("mime:html", Policy.mimeType("web/index.html"), "text/html");
        eq("mime:js", Policy.mimeType("web/data/courses/mwl.js"), "text/javascript");
        eq("mime:css", Policy.mimeType("web/styles.css"), "text/css");
        eq("mime:json", Policy.mimeType("x.JSON"), "application/json");
        eq("mime:bin", Policy.mimeType("web/x.bin"), "application/octet-stream");
        eq("text:js", Policy.isText("text/javascript"), true);
        eq("text:png", Policy.isText("image/png"), false);

        // 뒤로 가기
        eq("back:today", Policy.back(o + "/index.html#/today", true), Policy.Back.EXIT);
        eq("back:noHash", Policy.back(o + "/index.html", true), Policy.Back.EXIT);
        eq("back:root", Policy.back(o + "/", false), Policy.Back.EXIT);
        eq("back:review", Policy.back(o + "/index.html#/review", true), Policy.Back.BACK);
        eq("back:reviewNoHistory", Policy.back(o + "/index.html#/review", false), Policy.Back.HOME);
        eq("back:merge", Policy.back(o + "/index.html#/import/merge", true), Policy.Back.BACK);
        eq("back:null", Policy.back(null, false), Policy.Back.EXIT);
        eq("back:outside", Policy.back("https://example.com/", true), Policy.Back.BACK);

        // 내보낼 파일 이름
        eq("name:ok:zip", Policy.fileNameOk("mylearner-exchange-2026-11-10-aaaa00.zip"), true);
        eq("name:ok:jsonl", Policy.fileNameOk("mylearner-log-2026-11-10.jsonl"), true);
        eq("name:ok:json", Policy.fileNameOk("progress.json"), true);
        eq("name:ok:dot", Policy.fileNameOk(".hidden.zip"), false);
        eq("name:ok:slash", Policy.fileNameOk("a/b.zip"), false);
        eq("name:ok:exe", Policy.fileNameOk("a.exe"), false);
        eq("name:ok:null", Policy.fileNameOk(null), false);
        eq("name:keep", Policy.fileName("mylearner-exchange-2026-11-10-aaaa00.zip"), "mylearner-exchange-2026-11-10-aaaa00.zip");
        eq("name:slash", Policy.fileName("../../etc/passwd"), "etcpasswd.zip");
        eq("name:korean", Policy.fileName("교환.zip"), "mylearner-exchange.zip");
        eq("name:empty", Policy.fileName(""), "mylearner-exchange.zip");
        eq("name:null", Policy.fileName(null), "mylearner-exchange.zip");
        eq("name:jsonl", Policy.fileName("log.JSONL"), "log.jsonl");
        eq("name:noExt", Policy.fileName("backup"), "backup.zip");
        eq("name:dots", Policy.fileName("...hidden.zip"), "hidden.zip");
        eq("name:long", Policy.fileName(new String(new char[200]).replace('\0', 'a') + ".zip").length(), 94);
        eq("name:alwaysOk", Policy.fileNameOk(Policy.fileName("x/../..zip")), true);
        eq("mime:zip", Policy.fileMime("a.zip"), "application/zip");
        eq("mime:jsonl", Policy.fileMime("a.jsonl"), "text/plain");
        eq("mime:json2", Policy.fileMime("a.json"), "application/json");
        eq("b64:max", Policy.MAX_B64_CHARS >= Policy.MAX_FILE_BYTES / 3 * 4, true);

        // 바탕색 → 상태 표시줄 아이콘
        eq("css:rgb", Policy.cssColor("rgb(245, 246, 248)"), 0xFFF5F6F8);
        eq("css:rgba1", Policy.cssColor("rgba(17, 19, 23, 1)"), 0xFF111317);
        eq("css:transparent", Policy.cssColor("rgba(0, 0, 0, 0)"), null);
        eq("css:hex", Policy.cssColor("#111317"), 0xFF111317);
        eq("css:bad", Policy.cssColor("red"), null);
        eq("css:over", Policy.cssColor("rgb(300, 0, 0)"), null);
        eq("css:null", Policy.cssColor(null), null);
        eq("light:page", Policy.isLight(0xFFF5F6F8), true);
        eq("light:dark", Policy.isLight(0xFF111317), false);
        eq("light:accent", Policy.isLight(0xFF1F5FBF), false);

        // 파일 고르기·저장 위치 고르기가 돌려준 주소 — content: 만
        eq("picked:content", Policy.pickedOk("content"), true);
        eq("picked:file", Policy.pickedOk("file"), false);
        eq("picked:upper", Policy.pickedOk("CONTENT"), false);
        eq("picked:android.resource", Policy.pickedOk("android.resource"), false);
        eq("picked:null", Policy.pickedOk(null), false);

        // 시작 주소·CSP
        eq("start:isApp", Policy.isApp(Policy.START), true);
        eq("start:asset", Policy.assetPath(Policy.START), "web/index.html");
        eq("start:backExits", Policy.back(Policy.START, false), Policy.Back.EXIT);
        eq("csp:self", Policy.CSP.startsWith("default-src 'self'; script-src 'self';"), true);
        eq("csp:frames", Policy.CSP.endsWith("frame-ancestors 'none'"), true);
        eq("csp:noInline", Policy.CSP.contains("unsafe-inline"), false);

        System.out.println("PolicyTest " + pass + "건 통과 · 실패 " + fail + "건");
        System.exit(fail == 0 ? 0 : 1);
    }
}
