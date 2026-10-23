package io.github.aimfoot.scadshape;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
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
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * scadshape offline: the web app (assets/www, built by build.sh) in a WebView. The files are served from
 * https://appassets.androidplatform.net/ (a secure origin: WASM, workers and IndexedDB work as on the
 * web); all other network access is blocked. The bridge ScadshapeAndroid (src/android.ts on the page side)
 * saves and shares files, colors the system bars and hands over files that other apps open.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/index.html";
    static final int REQ_FILE = 1;
    static final long MAX_IN = 64L << 20; // the same order of magnitude as the import's STL limit
    static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("wasm", "application/wasm");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("woff2", "font/woff2");
        MIME.put("txt", "text/plain");
    }

    WebView web;
    FrameLayout root;
    ValueCallback<Uri[]> fileCallback;
    volatile String pendingFile = ""; // JSON { name, data } until the page fetches it (takeFile)

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        applyInsets(root);
        setupWebView();
        if (Build.VERSION.SDK_INT >= 33)
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        web.loadUrl(HOME);
        handleIntent(getIntent());
    }

    @SuppressWarnings("deprecation") // setDecorFitsSystemWindows: needed for Android 11–14
    void applyInsets(View v) {
        if (Build.VERSION.SDK_INT >= 30) {
            // Edge to edge (forced from Android 15) and padding by hand, so the toolbar does not
            // end up under the status bar and the fields stay above the keyboard.
            getWindow().setDecorFitsSystemWindows(false);
            v.setOnApplyWindowInsetsListener((view, ins) -> {
                Insets i = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        } else {
            v.setFitsSystemWindows(true);
        }
    }

    void setupWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false); // the app has its own touch gestures
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "ScadshapeAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
    }

    // --- The app's files ---

    static String ext(String path) {
        int slash = path.lastIndexOf('/'), dot = path.lastIndexOf('.');
        return dot > slash ? path.substring(dot + 1).toLowerCase() : "";
    }

    static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason,
                Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(new byte[0]));
    }

    WebResourceResponse asset(Uri u) {
        String path = u.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        if (path.contains("..") || path.contains("//")) return status(404, "Not Found");
        try {
            InputStream in = getAssets().open("www" + path);
            String mime = MIME.getOrDefault(ext(path), "application/octet-stream");
            boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("+xml");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK",
                    Collections.singletonMap("Cache-Control", "no-cache"), in);
        } catch (IOException e) {
            return status(404, "Not Found");
        }
    }

    class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return asset(u);
            // WebView handles data:/blob: itself; the network is never used.
            String scheme = u.getScheme();
            if ("data".equals(scheme) || "blob".equals(scheme)) return null;
            return status(403, "Offline");
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if ("https".equals(u.getScheme()) && HOST.equals(u.getHost())) return false;
            openExternal(u);
            return true;
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detail) {
            // The renderer died (usually memory): restart the page. The model is saved in the page's storage.
            ((ViewGroup) v.getParent()).removeView(v);
            v.destroy();
            recreate();
            return true;
        }
    }

    void openExternal(Uri u) {
        String scheme = u.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme) && !"mailto".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show();
        }
    }

    // --- File chooser (<input type=file>) ---

    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != REQ_FILE || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        fileCallback = null;
    }

    // --- The bridge to the page (called on WebView's JavaBridge thread) ---

    /** Only a file name: no directories, nothing that starts with a dot. */
    static String safeName(String name) {
        String n = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]+", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        return n.isEmpty() ? "scadshape" : n;
    }

    class Bridge {
        @JavascriptInterface
        public String saveFile(String name, String mime, String base64) {
            try {
                byte[] bytes = Base64.getDecoder().decode(base64);
                String n = safeName(name);
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, n);
                // Otherwise MediaStore adds its own file extension for types it does not know.
                cv.put(MediaStore.MediaColumns.MIME_TYPE, Files.mime(n));
                cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver cr = getContentResolver();
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) return "MediaStore";
                try (OutputStream out = cr.openOutputStream(uri)) {
                    out.write(bytes);
                }
                cv.clear();
                cv.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(uri, cv, null, null);
                return "";
            } catch (Exception e) {
                return String.valueOf(e.getMessage());
            }
        }

        @JavascriptInterface
        public String shareFile(String name, String mime, String base64) {
            try {
                File dir = Files.dir(MainActivity.this);
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete(); // only the latest share is kept
                if (!dir.isDirectory() && !dir.mkdirs()) return "cache";
                File f = new File(dir, safeName(name));
                try (OutputStream out = new FileOutputStream(f)) {
                    out.write(Base64.getDecoder().decode(base64));
                }
                Uri uri = Files.uriFor(f);
                String type = mime == null || mime.isEmpty() ? Files.mime(f.getName()) : mime;
                Intent send = new Intent(Intent.ACTION_SEND)
                        .setType(type)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .putExtra(Intent.EXTRA_TITLE, f.getName())
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(ClipData.newRawUri(f.getName(), uri));
                runOnUiThread(() -> startActivity(Intent.createChooser(send, f.getName())));
                return "";
            } catch (Exception e) {
                return String.valueOf(e.getMessage());
            }
        }

        @JavascriptInterface
        public void setBars(String color, boolean dark) {
            runOnUiThread(() -> {
                try {
                    root.setBackgroundColor(Color.parseColor(color));
                } catch (IllegalArgumentException e) {
                    return;
                }
                if (Build.VERSION.SDK_INT >= 30) {
                    int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : light, light);
                }
            });
        }

        @JavascriptInterface
        public String takeFile() {
            String f = pendingFile;
            pendingFile = "";
            return f;
        }
    }

    // --- Files that other apps open or share to the app ---

    void handleIntent(Intent i) {
        if (i == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(i.getAction())) uri = i.getData();
        else if (Intent.ACTION_SEND.equals(i.getAction())) uri = streamExtra(i);
        if (uri == null) return;
        Uri u = uri;
        new Thread(() -> {
            try {
                String name = displayName(u);
                byte[] bytes = read(u);
                JSONObject o = new JSONObject();
                o.put("name", name);
                o.put("data", Base64.getEncoder().encodeToString(bytes));
                pendingFile = o.toString();
                // A loaded page fetches the file right away; otherwise initAndroid() does it when it starts.
                runOnUiThread(() -> web.evaluateJavascript("window.scadshapeOpenPending && scadshapeOpenPending()", null));
            } catch (IOException | JSONException | SecurityException e) {
                runOnUiThread(() -> Toast.makeText(this, R.string.cannot_open_file, Toast.LENGTH_SHORT).show());
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    static Uri streamExtra(Intent i) {
        return Build.VERSION.SDK_INT >= 33 ? i.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : i.getParcelableExtra(Intent.EXTRA_STREAM);
    }

    String displayName(Uri u) {
        try (Cursor c = getContentResolver().query(u, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {
            // not every source answers query
        }
        String last = u.getLastPathSegment();
        return last != null ? last.substring(last.lastIndexOf('/') + 1) : "file";
    }

    byte[] read(Uri u) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(u)) {
            if (in == null) throw new IOException("no data");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[1 << 16];
            for (int n; (n = in.read(buf)) > 0; ) {
                out.write(buf, 0, n);
                if (out.size() > MAX_IN) throw new IOException("too large");
            }
            return out.toByteArray();
        }
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        handleIntent(i);
    }

    // --- Back and lifecycle ---

    void goBack() {
        // The page closes the topmost thing (dialog, panel, sketch mode …); if nothing is open the app goes to the background.
        web.evaluateJavascript("window.scadshapeBack ? scadshapeBack() : false", v -> {
            if (!"true".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack(); // Android 12 and older; newer ones use the callback in onCreate
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web.getParent() != null) web.destroy();
        super.onDestroy();
    }
}
