package io.github.hipiboy7.mylearningplatform;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * MyLearningPlatform 안드로이드 앱 — 한 화면(WebView)이 APK 안 web/ 사본(모바일판)을 가상 주소 https://appassets.androidplatform.net/ 로 연다.
 * 계산은 화면의 web/core/*.js 가 한다. 이 액티비티는 파일을 내주고, 기록을 앱 전용 파일에 원자적으로 적고(Kv — 다리 kv*),
 * 교환 파일을 저장 위치에 쓰거나 공유하고, 파일을 고르게 하고, 바깥 링크를 막거나 폰 브라우저로 넘기는 일만 한다. 권한이 하나도 없다(인터넷 포함).
 * MWL mobile/android/src/io/github/hipiboy7/mwl/MainActivity.java(MiddlewareLearner@e55b9c0)를 옮겨 고쳤다 — 저장 거울 대신 파일 KV, 바이트 저장·공유.
 * 문서: docs/P4_요구사항정의서_Mobile.md FR-401~406·410·421, docs/P4_설계서_Mobile.md 3.2·3.3절
 */
public final class MainActivity extends Activity {
    private static final int REQ_OPEN = 1;
    private static final int REQ_SAVE = 2;
    /** 저장 위치를 고르는 동안 내보낼 바이트를 둘 곳(앱 전용 캐시). 그 사이 앱이 다시 만들어져도 남는다 */
    private static final String PENDING = "pending-export.bin";
    private static final String KEY_PENDING = "mylearner.pendingName";

    private FrameLayout root;
    private WebView web;
    private ValueCallback<Uri[]> chooser;
    private String pendingName;
    private Object backCallback;
    private Kv kv;
    /** 화면이 마지막으로 연 주소 — 다리 메서드는 WebView 의 JavaBridge 스레드에서 불려 web.getUrl() 을 못 쓴다 */
    private volatile String lastUrl = "";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        kv = new Kv(new File(getFilesDir(), "kv"));
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.page));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            Api30.edgeToEdge(getWindow(), root);
        }
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);   // 시험용 디버그 빌드에서만(릴리스 APK 는 debuggable 이 아니다)
        }
        web = newWebView();
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        if (state != null) {
            pendingName = state.getString(KEY_PENDING);
        }
        lastUrl = Policy.START;
        if (state == null || web.restoreState(state) == null) {
            web.loadUrl(Policy.START);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = Api33.register(this, this::onBack);
        }
    }

    private WebView newWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // 화면 설정·쓰는 탭 임대만 — 기록은 Kv 파일에 둔다
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(true);               // 넓은 표를 두 손가락으로 키워 볼 수 있게
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);    // 판을 올리면 APK 안의 새 파일을 바로 쓴다
        s.setSafeBrowsingEnabled(false);              // 주소 평판을 바깥에 묻지 않는다
        w.setBackgroundColor(Color.TRANSPARENT);
        w.addJavascriptInterface(new Bridge(), "MyLearnerAndroid");
        w.setWebViewClient(new Client());
        w.setWebChromeClient(new Chrome());
        w.setDownloadListener((url, userAgent, disposition, mime, length) -> toast("이 앱은 파일을 내려받지 않습니다 - 설정 → 교환 파일을 쓰세요"));
        return w;
    }

    // ------------------------------------------------------------------ 자산 응답(바깥으로 나가는 요청은 없다)
    WebResourceResponse serve(String url, String method) {
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            return null;
        }
        if (!Policy.isApp(url)) {
            return empty(403, "Forbidden");
        }
        String path = Policy.assetPath(url);
        if (path == null) {
            return empty(404, "Not Found");
        }
        if (!"GET".equalsIgnoreCase(method)) {
            return empty(405, "Method Not Allowed");
        }
        try {
            InputStream in = getAssets().open(path);
            String mime = Policy.mimeType(path);
            return new WebResourceResponse(mime, Policy.isText(mime) ? "utf-8" : null, 200, "OK", headers(mime), in);
        } catch (IOException e) {
            return empty(404, "Not Found");           // 예: /api/health — 화면은 다리를 먼저 보고 서버를 찾지 않는다
        }
    }

    private static Map<String, String> headers(String mime) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("X-Content-Type-Options", "nosniff");
        h.put("Referrer-Policy", "no-referrer");
        if (mime.startsWith("text/html")) {
            h.put("Content-Security-Policy", Policy.CSP);
        }
        return h;
    }

    private static WebResourceResponse empty(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, headers("text/plain"), new ByteArrayInputStream(new byte[0]));
    }

    private final class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            return serve(req.getUrl().toString(), req.getMethod());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            String url = req.getUrl().toString();
            switch (Policy.navigation(url)) {
                case IN_APP:
                    return false;
                case EXTERNAL:
                    if (req.hasGesture()) {
                        askExternal(url);                 // 사용자가 누른 링크만 — 스크립트가 몰래 여는 것은 막는다
                    }
                    return true;
                default:
                    return true;                          // intent:·file:·javascript: 등은 막는다
            }
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            lastUrl = url == null ? "" : url;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            lastUrl = url == null ? "" : url;
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == web) {                            // 화면 엔진이 죽었다 — 새로 만든다(기록은 Kv 파일에 있다)
                root.removeView(web);
                web.destroy();
                web = null;
                recreate();
            }
            return true;
        }
    }

    // ------------------------------------------------------------------ 확인 창·파일 고르기·권한
    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (chooser != null) {
                chooser.onReceiveValue(null);
            }
            chooser = callback;
            // 카톡 등으로 받은 .zip·.json 은 형식이 제각각이라 거르지 않는다 — 내용은 화면이 검사한다(core/exchange.js sniff)
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
            try {
                startActivityForResult(i, REQ_OPEN);
            } catch (ActivityNotFoundException e) {
                chooser = null;
                callback.onReceiveValue(null);
                toast("파일을 고르는 화면을 열 수 없습니다");
            }
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            ask(message, result, false);
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            ask(message, result, true);
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String value, JsPromptResult result) {
            result.cancel();
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            return false;
        }
    }

    /** 화면의 alert·confirm 을 앱 창으로 — 기본 창은 제목에 가상 주소를 보여 헷갈린다 */
    private void ask(String message, final JsResult result, boolean confirm) {
        if (isFinishing()) {
            result.cancel();
            return;
        }
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(R.string.app_name)
                .setMessage(message)
                .setOnCancelListener(d -> result.cancel())
                .setPositiveButton("확인", (d, w) -> result.confirm());
        if (confirm) {
            b.setNegativeButton("취소", (d, w) -> result.cancel());
        }
        b.show();
    }

    @Override
    protected void onActivityResult(int request, int code, Intent data) {
        Uri uri = (code == RESULT_OK && data != null) ? data.getData() : null;
        if (uri != null && !Policy.pickedOk(uri.getScheme())) {
            uri = null;
        }
        if (request == REQ_OPEN) {
            if (chooser != null) {
                chooser.onReceiveValue(uri == null ? null : new Uri[]{uri});
                chooser = null;
            }
            return;
        }
        if (request == REQ_SAVE) {
            finishSave(uri);
            return;
        }
        super.onActivityResult(request, code, data);
    }

    // ------------------------------------------------------------------ 교환 파일 저장·공유
    /** 다리가 받은 base64 → 캐시의 대기 파일. 성공하면 "" */
    private String stash(String b64) {
        if (b64 == null || b64.length() > Policy.MAX_B64_CHARS) {
            return "파일이 너무 큽니다";
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            return "파일을 받지 못했습니다";
        }
        try (FileOutputStream out = new FileOutputStream(new File(getCacheDir(), PENDING))) {
            out.write(bytes);
            return "";
        } catch (IOException e) {
            return "파일을 만들지 못했습니다: " + e.getMessage();
        }
    }

    private void done(String kind, boolean ok, String msg) {
        if (web != null) {
            web.evaluateJavascript("window.MyLearner && MyLearner.platform && MyLearner.platform.done && MyLearner.platform.done("
                    + JSONObject.quote(kind) + "," + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")", null);
        }
    }

    private void startSave(String file) {
        pendingName = file;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(Policy.fileMime(file)).putExtra(Intent.EXTRA_TITLE, file);
        try {
            startActivityForResult(i, REQ_SAVE);
        } catch (ActivityNotFoundException e) {
            done("save", false, "저장 위치를 고르는 화면을 열 수 없습니다 - 공유를 쓰세요");
        }
    }

    private void finishSave(Uri uri) {
        File src = new File(getCacheDir(), PENDING);
        String name = pendingName != null ? pendingName : "교환 파일";
        pendingName = null;
        if (uri == null) {
            src.delete();   // 취소해도 기록 전체가 담긴 임시 파일을 남기지 않는다(독립 점검 2026-11-10)
            done("save", false, "취소");
            return;
        }
        if (!src.isFile()) {
            done("save", false, "내보낼 파일이 없습니다 - 다시 누르세요");
            return;
        }
        try (InputStream in = new FileInputStream(src); OutputStream out = openForWrite(uri)) {
            copy(in, out);
            toast("저장했습니다 — " + name);
            done("save", true, name);
        } catch (IOException | RuntimeException e) {
            done("save", false, "저장하지 못했습니다: " + e.getMessage());
        } finally {
            src.delete();
        }
    }

    private OutputStream openForWrite(Uri uri) throws IOException {
        OutputStream out;
        try {
            out = getContentResolver().openOutputStream(uri, "wt");
        } catch (IllegalArgumentException | IOException e) {
            out = getContentResolver().openOutputStream(uri, "w");
        }
        if (out == null) {
            throw new IOException("저장 위치를 열 수 없습니다");
        }
        return out;
    }

    private void share(String file) {
        File dir = new File(getCacheDir(), ShareProvider.DIR);
        File[] old = dir.listFiles();
        if (old != null) {
            for (File f : old) {
                f.delete();
            }
        }
        File src = new File(getCacheDir(), PENDING);
        if (!dir.isDirectory() && !dir.mkdirs() || !src.renameTo(new File(dir, file))) {
            done("share", false, "보낼 파일을 만들지 못했습니다");
            return;
        }
        Uri uri = ShareProvider.uriFor(file);
        Intent send = new Intent(Intent.ACTION_SEND).setType(Policy.fileMime(file))
                .putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri(file, uri));
        try {
            startActivity(Intent.createChooser(send, "교환 파일 보내기"));
            done("share", true, file);
        } catch (ActivityNotFoundException e) {
            done("share", false, "보낼 앱이 없습니다 - 파일로 저장을 쓰세요");
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[1 << 16];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
    }

    // ------------------------------------------------------------------ 바깥 링크 · 상태 표시줄 색
    private void askExternal(String url) {
        final Uri u = Uri.parse(url);
        new AlertDialog.Builder(this)
                .setTitle("바깥 링크")
                .setMessage(u.getHost() + " 을(를) 휴대폰의 브라우저로 엽니다. 이 앱은 인터넷을 쓰지 않습니다.")
                .setPositiveButton("열기", (d, w) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException e) {
                        toast("열 브라우저가 없습니다");
                    }
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void setBars(String css) {
        Integer c = Policy.cssColor(css);
        if (c == null) {
            return;
        }
        root.setBackgroundColor(c);
        boolean light = Policy.isLight(c);
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            Api30.lightBars(w, light);
        } else {
            w.setStatusBarColor(c);
            w.setNavigationBarColor(c);
            View d = w.getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            int v = d.getSystemUiVisibility();
            d.setSystemUiVisibility(light ? (v | flags) : (v & ~flags));
        }
    }

    private boolean onAppPage() {
        return web != null && Policy.isApp(web.getUrl());
    }

    /** 화면(web/)에서 부르는 다리 — 저장 어댑터(store/android.js)와 셸 스크립트(android-shell.js)만 쓴다. 이 앱 주소의 화면일 때만 듣는다 */
    public final class Bridge {
        // 파일 KV — 동기(파일에 적고 돌아온다). 저장 어댑터가 쓴다
        @JavascriptInterface
        public String kvGet(String name) {
            return Policy.isApp(lastUrl) ? kv.get(name) : null;
        }

        @JavascriptInterface
        public String kvPut(String name, String value) {
            return Policy.isApp(lastUrl) ? kv.put(name, value) : "이 앱 화면이 아닙니다";
        }

        @JavascriptInterface
        public String kvDel(String name) {
            return Policy.isApp(lastUrl) ? kv.del(name) : "이 앱 화면이 아닙니다";
        }

        @JavascriptInterface
        public String kvList(String prefix) {
            return Policy.isApp(lastUrl) ? Kv.json(kv.list(prefix)) : "[]";
        }

        // 교환 파일 — 바이트는 base64 로 받는다. 시작하면 "", 끝나면 화면의 MyLearner.platform.done(kind, ok, msg)
        @JavascriptInterface
        public String saveFile(final String name, String b64, String mime) {
            if (!Policy.isApp(lastUrl)) {
                return "이 앱 화면이 아닙니다";
            }
            String err = stash(b64);
            if (!err.isEmpty()) {
                return err;
            }
            final String file = Policy.fileName(name);
            runOnUiThread(() -> startSave(file));
            return "";
        }

        @JavascriptInterface
        public String shareFile(final String name, String b64, String mime) {
            if (!Policy.isApp(lastUrl)) {
                return "이 앱 화면이 아닙니다";
            }
            String err = stash(b64);
            if (!err.isEmpty()) {
                return err;
            }
            final String file = Policy.fileName(name);
            runOnUiThread(() -> share(file));
            return "";
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(() -> {
                if (onAppPage() && Policy.navigation(url) == Policy.Nav.EXTERNAL) {
                    askExternal(url);
                }
            });
        }

        @JavascriptInterface
        public void setBars(final String css) {
            runOnUiThread(() -> {
                if (onAppPage()) {
                    MainActivity.this.setBars(css);
                }
            });
        }

        @JavascriptInterface
        public String info() {
            String wv = "";
            if (Build.VERSION.SDK_INT >= 26) {
                android.content.pm.PackageInfo p = WebView.getCurrentWebViewPackage();
                wv = p == null ? "" : p.versionName;
            }
            try {
                return new JSONObject().put("sdk", Build.VERSION.SDK_INT).put("webview", wv).toString();
            } catch (org.json.JSONException e) {
                return "{}";
            }
        }
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_LONG).show();
    }

    // ------------------------------------------------------------------ 뒤로 가기 · 생명 주기
    private void onBack() {
        if (web == null) {
            finish();
            return;
        }
        switch (Policy.back(web.getUrl(), web.canGoBack())) {
            case EXIT:
                finish();
                break;
            case BACK:
                web.goBack();
                break;
            default:
                web.loadUrl(Policy.START);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        onBack();                                          // Android 8~12. 13 이상은 OnBackInvokedCallback(Api33)
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            // 날짜가 바뀌었으면 화면을 새로 읽는다(P3 FR-306 — app/state.js checkDay). 앱이 앞으로 올 때 직접 부른다
            web.evaluateJavascript("window.MyLearner && MyLearner.app && MyLearner.app.checkDay && MyLearner.app.checkDay()", null);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) {
            web.saveState(out);
        }
        out.putString(KEY_PENDING, pendingName);
    }

    @Override
    protected void onDestroy() {
        if (backCallback != null) {
            Api33.unregister(this, backCallback);
        }
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Android 11(API 30) 이상 — 화면을 가장자리까지 그리고 상태 표시줄·내비게이션 막대·자판·노치만큼 여백을 둔다 */
    private static final class Api30 {
        static void edgeToEdge(Window w, View root) {
            w.setDecorFitsSystemWindows(false);
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
            w.setNavigationBarContrastEnforced(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets b = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        static void lightBars(Window w, boolean light) {
            WindowInsetsController c = w.getInsetsController();
            if (c == null) {
                return;
            }
            int m = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(light ? m : 0, m);
        }
    }

    /** Android 13(API 33) 이상의 뒤로 가기 — 예측형 뒤로 가기(제스처)와 단추 모두 여기로 온다 */
    private static final class Api33 {
        static Object register(Activity a, Runnable onBack) {
            OnBackInvokedCallback cb = onBack::run;
            a.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
            return cb;
        }

        static void unregister(Activity a, Object cb) {
            a.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback((OnBackInvokedCallback) cb);
        }
    }
}
