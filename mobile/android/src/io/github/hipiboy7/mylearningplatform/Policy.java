package io.github.hipiboy7.mylearningplatform;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/**
 * 앱이 무엇을 열고 무엇을 막을지 정하는 규칙 — 안드로이드 API 를 쓰지 않아 개발 VM 의 JVM 에서 바로 시험한다(test/.../PolicyTest.java).
 * 계산(복습·계획·합치기)은 여기에 없다. 화면의 web/core/*.js 한 벌이 한다.
 * MWL mobile/android/src/io/github/hipiboy7/mwl/Policy.java(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다 — 파일 이름 규칙(교환 파일 .zip·기록 .jsonl), CSP(MyLearner 화면).
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-403~406, docs/P4_설계서_Mobile.md 3.2절
 */
final class Policy {
    /** 안드로이드가 앱 자산용으로 비워 둔 이름 — androidx 의 WebViewAssetLoader 와 같은 주소. 바깥으로 나가지 않고 앱이 APK 안 파일로 답한다 */
    static final String HOST = "appassets.androidplatform.net";
    static final String ORIGIN = "https://" + HOST;
    /** 첫 화면. 해시를 붙여 열어 화면 기록이 한 번 더 쌓이지 않게 한다 — 뒤로 가기 한 번에 앱이 닫힌다 */
    static final String START = ORIGIN + "/index.html#/today";
    /** APK 안에서 web/ 사본이 있는 곳(assets/web/) */
    static final String ASSET_DIR = "web/";
    /** 다리로 받는 파일(교환 파일)의 상한 — 바이트 64 MiB, base64 글자로는 4/3 배 */
    static final int MAX_FILE_BYTES = 64 * 1024 * 1024;
    static final int MAX_B64_CHARS = (MAX_FILE_BYTES + 2) / 3 * 4;
    /**
     * 화면 문서에 붙이는 보안 정책 — web/index.html 의 메타 CSP 와 같은 글 + frame-ancestors(메타에서는 무시된다).
     * 같은지는 tests/integration/py/test_android_static.py 가 본다. 화면은 이 앱 주소(자산) 말고는 아무것도 불러오거나 보내지 못한다
     */
    static final String CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
            + "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

    enum Nav { IN_APP, EXTERNAL, BLOCK }

    enum Back { EXIT, BACK, HOME }

    private Policy() {
    }

    private static URI parse(String url) {
        if (url == null) {
            return null;
        }
        try {
            return new URI(url.trim());
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** 이 앱의 주소인가 — https://appassets.androidplatform.net (기본 포트, 계정 정보 없음) */
    static boolean isApp(String url) {
        URI u = parse(url);
        return u != null && "https".equalsIgnoreCase(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost())
                && (u.getPort() == -1 || u.getPort() == 443) && u.getRawUserInfo() == null;
    }

    /** 화면이 다른 주소로 옮겨 가려 할 때. 이 앱 → 그대로 · 바깥 http·https → 휴대폰 브라우저(앱이 묻고 넘긴다) · 그 밖 → 막는다 */
    static Nav navigation(String url) {
        if (isApp(url)) {
            return Nav.IN_APP;
        }
        URI u = parse(url);
        if (u == null || u.getHost() == null || u.getHost().isEmpty() || u.getRawUserInfo() != null) {
            return Nav.BLOCK;
        }
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        return ("http".equals(scheme) || "https".equals(scheme)) ? Nav.EXTERNAL : Nav.BLOCK;
    }

    /** 요청 주소 → APK 안 자산 경로(web/…). 이 앱 주소가 아니거나 경로가 이상하면 null(앱은 404). 영문·숫자·. _ - / 만, 퍼센트 부호화·.. 거부 */
    static String assetPath(String url) {
        if (!isApp(url)) {
            return null;
        }
        String path = parse(url).getRawPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        if (!path.matches("/[A-Za-z0-9._/-]+")) {
            return null;
        }
        String rel = path.substring(1);
        for (String part : rel.split("/", -1)) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
                return null;
            }
        }
        return ASSET_DIR + rel;
    }

    static String mimeType(String path) {
        String p = path == null ? "" : path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) {
            return "text/html";
        }
        if (p.endsWith(".js")) {
            return "text/javascript";
        }
        if (p.endsWith(".css")) {
            return "text/css";
        }
        if (p.endsWith(".json")) {
            return "application/json";
        }
        if (p.endsWith(".svg")) {
            return "image/svg+xml";
        }
        if (p.endsWith(".png")) {
            return "image/png";
        }
        if (p.endsWith(".txt")) {
            return "text/plain";
        }
        return "application/octet-stream";
    }

    /** 글자 자료인가 — 응답에 utf-8 을 적는다 */
    static boolean isText(String mime) {
        return mime.startsWith("text/") || "application/json".equals(mime) || "image/svg+xml".equals(mime);
    }

    /** 뒤로 가기. 오늘 화면(첫 화면)이면 앱을 닫고, 아니면 화면 기록에서 한 걸음 뒤로, 뒤가 없으면 오늘로 */
    static Back back(String url, boolean canGoBack) {
        if (!isApp(url)) {
            return canGoBack ? Back.BACK : Back.EXIT;
        }
        URI u = parse(url);
        String path = u.getRawPath() == null ? "" : u.getRawPath();
        String frag = u.getRawFragment() == null ? "" : u.getRawFragment();
        boolean index = path.isEmpty() || "/".equals(path) || "/index.html".equals(path);
        if (index && (frag.isEmpty() || "/".equals(frag) || "/today".equals(frag))) {
            return Back.EXIT;
        }
        return canGoBack ? Back.BACK : Back.HOME;
    }

    /**
     * 파일 고르기·저장 위치 고르기가 돌려준 주소의 스킴. 시스템 문서 화면은 늘 content: 를 준다. 다른 앱이 file: 을 돌려주면
     * 이 앱의 권한으로 앱 전용 파일(기록)을 열거나 덮어쓸 수 있다 — 글자 그대로 "content" 만 받는다
     */
    static boolean pickedOk(String scheme) {
        return "content".equals(scheme);
    }

    /** 내보내고 공유할 파일 이름의 규칙 — 영문·숫자로 시작, 영문·숫자·. _ -, 끝은 .zip·.jsonl·.json */
    static boolean fileNameOk(String name) {
        return name != null && name.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,99}\\.(zip|jsonl|json)");
    }

    /** 화면이 준 이름을 규칙에 맞춘다 — 그 밖의 글자를 지우고, 앞의 점을 떼고, 길이를 줄이고, 끝이 맞지 않으면 .zip 을 붙인다 */
    static String fileName(String name) {
        String s = name == null ? "" : name.trim();
        String low = s.toLowerCase(Locale.ROOT);   // 확장자는 거르기 전에 뗀다 — '교환.zip' 이 'zip' 만 남지 않게
        String ext = low.endsWith(".zip") ? ".zip" : low.endsWith(".jsonl") ? ".jsonl" : low.endsWith(".json") ? ".json" : "";
        String stem = s.substring(0, s.length() - ext.length()).replaceAll("[^A-Za-z0-9._-]", "");
        stem = stem.replaceAll("^[._-]+", "").replaceAll("[.]+$", "");
        if (stem.length() > 90) {
            stem = stem.substring(0, 90);
        }
        if (stem.isEmpty()) {
            stem = "mylearner-exchange";
        }
        return stem + (ext.isEmpty() ? ".zip" : ext);
    }

    /** 파일 이름 → 저장·공유 때 알리는 형식 */
    static String fileMime(String name) {
        String p = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (p.endsWith(".zip")) {
            return "application/zip";
        }
        if (p.endsWith(".json")) {
            return "application/json";
        }
        return "text/plain";
    }

    /** 브라우저가 계산한 바탕색("rgb(245, 246, 248)"·"rgba(…)"·"#f5f6f8") → 0xFFRRGGBB. 못 읽거나 투명하면 null */
    static Integer cssColor(String css) {
        if (css == null) {
            return null;
        }
        String s = css.trim().toLowerCase(Locale.ROOT);
        try {
            if (s.matches("#[0-9a-f]{6}")) {
                return 0xFF000000 | Integer.parseInt(s.substring(1), 16);
            }
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*(?:,\\s*([0-9.]+)\\s*)?\\)").matcher(s);
            if (!m.matches()) {
                return null;
            }
            if (m.group(4) != null && Double.parseDouble(m.group(4)) < 1.0) {
                return null;
            }
            int r = Integer.parseInt(m.group(1));
            int g = Integer.parseInt(m.group(2));
            int b = Integer.parseInt(m.group(3));
            if (r > 255 || g > 255 || b > 255) {
                return null;
            }
            return 0xFF000000 | (r << 16) | (g << 8) | b;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** 밝은 바탕인가 — 그러면 상태 표시줄 아이콘을 어둡게 한다. 상대 휘도(WCAG) 0.4 를 기준으로 가른다 */
    static boolean isLight(int argb) {
        double r = lin(((argb >> 16) & 0xFF) / 255.0);
        double g = lin(((argb >> 8) & 0xFF) / 255.0);
        double b = lin((argb & 0xFF) / 255.0);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
    }

    private static double lin(double c) {
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
}
