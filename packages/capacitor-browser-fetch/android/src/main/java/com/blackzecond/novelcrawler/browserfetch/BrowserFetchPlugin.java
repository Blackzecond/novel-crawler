package com.blackzecond.novelcrawler.browserfetch;

import android.app.Dialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Window;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ConsoleMessage;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.ScrollView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "BrowserFetch")
public class BrowserFetchPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String targetUrl = call.getString("url");
        boolean expandToc = call.getBoolean("expandToc", false);
        if (targetUrl == null || !(targetUrl.startsWith("https://") || targetUrl.startsWith("http://"))) {
            call.reject("URL ไม่ถูกต้อง");
            return;
        }

        call.setKeepAlive(true);
        getActivity().runOnUiThread(() -> showBrowser(call, targetUrl, expandToc));
    }

    /**
     * Fetch one chapter in a hidden WebView. It shares Android's app-private
     * CookieManager with the visible WebView, but never displays UI or solves CAPTCHA.
     */
    @PluginMethod
    public void prefetch(PluginCall call) {
        String targetUrl = call.getString("url");
        if (targetUrl == null || !(targetUrl.startsWith("https://") || targetUrl.startsWith("http://"))) {
            call.reject("URL ไม่ถูกต้อง");
            return;
        }
        call.setKeepAlive(true);
        getActivity().runOnUiThread(() -> startBackgroundPrefetch(call, targetUrl));
    }

    private void startBackgroundPrefetch(PluginCall call, String targetUrl) {
        View content = getActivity().findViewById(android.R.id.content);
        if (!(content instanceof ViewGroup)) {
            call.setKeepAlive(false);
            call.reject("ไม่พบพื้นที่ WebView สำหรับดึงบทล่วงหน้า");
            return;
        }
        ViewGroup host = (ViewGroup) content;
        WebView webView = new WebView(getActivity());
        webView.setAlpha(0f);
        webView.setClickable(false);
        webView.setFocusable(false);
        webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setLayoutParams(new ViewGroup.LayoutParams(1, 1));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setLoadsImagesAutomatically(false);
        webView.getSettings().setBlockNetworkImage(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());
        host.addView(webView);

        final Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] finished = { false };
        final int[] stablePolls = { 0 };
        final String[] lastSignature = { "" };
        final Runnable[] pollTask = { null };
        final Runnable timeoutTask = () -> finishBackgroundPrefetch(
            call, webView, host, handler, pollTask[0], null, finished,
            null, "หมดเวลารอดึงบทถัดไป"
        );

        pollTask[0] = new Runnable() {
            @Override
            public void run() {
                if (finished[0]) return;
                String probeScript = "(()=>{const b=document.body?document.body.innerText:'';const h=document.documentElement?document.documentElement.innerHTML:'';const t=document.title||'';const u=location.href;const hl=h.toLowerCase();const challenge=u.toLowerCase().includes('/cdn-cgi/challenge-platform/')||hl.includes('__cf_chl_')||hl.includes('cf-browser-verification')||!!document.querySelector('#challenge-form,#challenge-running,.cf-challenge,[data-cf-challenge]')||b.includes('正在验证浏览器')||b.includes('检查您是否为机器人')||b.includes('检查您不是机器人')||b.includes('ตรวจสอบว่าคุณไม่ใช่บอต')||b.includes('กำลังตรวจสอบว่าคุณไม่ใช่บอต');const sig=u+'|'+t+'|'+b.length+'|'+h.length+'|'+b.slice(-160);return JSON.stringify({ready:document.readyState==='complete',challenge:challenge,bodyLength:b.trim().length,htmlLength:h.length,signature:sig})})()";
                webView.evaluateJavascript(probeScript, value -> {
                    if (finished[0]) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        JSONObject probe = new JSONObject(String.valueOf(decoded));
                        if (probe.optBoolean("challenge", true)) {
                            // A challenge that requires human interaction cannot be solved in the background.
                            stablePolls[0] = 0;
                            lastSignature[0] = "";
                            handler.postDelayed(this, 800);
                            return;
                        }
                        if (!probe.optBoolean("ready") || probe.optInt("bodyLength") < 180 || probe.optInt("htmlLength") < 1000) {
                            stablePolls[0] = 0;
                            lastSignature[0] = "";
                            handler.postDelayed(this, 500);
                            return;
                        }
                        String signature = probe.optString("signature", "");
                        if (signature.equals(lastSignature[0])) stablePolls[0]++;
                        else {
                            lastSignature[0] = signature;
                            stablePolls[0] = 1;
                        }
                        if (stablePolls[0] < 2) {
                            handler.postDelayed(this, 500);
                            return;
                        }

                        String captureScript = "(()=>{const root=document.documentElement?document.documentElement.cloneNode(true):null;if(root)root.querySelectorAll('script,style,noscript').forEach(n=>n.remove());return JSON.stringify({url:location.href,title:document.title||'',html:root?('<!doctype html>'+root.outerHTML):'',bodyText:document.body?document.body.innerText:''})})()";
                        webView.evaluateJavascript(captureScript, captured -> {
                            if (finished[0]) return;
                            try {
                                Object capturedDecoded = new JSONTokener(captured).nextValue();
                                JSONObject resultPage = new JSONObject(String.valueOf(capturedDecoded));
                                String html = resultPage.optString("html", "");
                                String bodyText = resultPage.optString("bodyText", "");
                                String title = resultPage.optString("title", "");
                                String pageUrl = resultPage.optString("url", "");
                                String lower = (title + " " + bodyText + " " + html).toLowerCase(Locale.ROOT);
                                boolean challenge = lower.contains("just a moment")
                                    || lower.contains("verify you are human")
                                    || lower.contains("cf-challenge")
                                    || lower.contains("cf-chl-")
                                    || lower.contains("challenge-platform")
                                    || bodyText.contains("正在验证浏览器")
                                    || bodyText.contains("เว็บไซต์นี้ใช้บริการรักษาความปลอดภัย")
                                    || bodyText.contains("ตรวจสอบว่าคุณไม่ใช่บอต")
                                    || pageUrl.toLowerCase(Locale.ROOT).contains("/cdn-cgi/challenge-platform/");
                                if (challenge || html.length() < 300 || bodyText.trim().length() < 80) {
                                    finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                        null, challenge ? "เว็บไซต์ยังต้องยืนยัน CAPTCHA" : "ไม่พบเนื้อหาบทที่สมบูรณ์");
                                    return;
                                }
                                CookieManager.getInstance().flush();
                                if (isManatokiUrl(pageUrl)) {
                                    runManatokiExtractor(webView, handler, finished, extraction -> {
                                        if (finished[0]) return;
                                        try {
                                            if (!extraction.optBoolean("ok")) {
                                                String reason = extraction.optString("error", "ไม่ทราบสาเหตุ");
                                                finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                                    null, "ดึงเนื้อหา Manatoki ไม่สำเร็จ: " + reason);
                                                return;
                                            }
                                            String extractedHtml = extraction.optString("html", "");
                                            String extractedTitle = extraction.optString("title", title);
                                            String extractedUrl = extraction.optString("url", pageUrl);
                                            if (extractedHtml.length() < 100 || !extractedHtml.contains("reader-content")) {
                                                finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                                    null, "ถอดรหัส Manatoki แล้วแต่ไม่พบเนื้อหาที่อ่านได้");
                                                return;
                                            }
                                            JSObject result = new JSObject();
                                            result.put("url", extractedUrl);
                                            result.put("title", extractedTitle);
                                            result.put("html", extractedHtml);
                                            finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                                result, null);
                                        } catch (Exception extractionError) {
                                            finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                                null, "อ่านผลการถอดรหัส Manatoki ไม่สำเร็จ");
                                        }
                                    });
                                    return;
                                }
                                JSObject result = new JSObject();
                                result.put("url", pageUrl);
                                result.put("title", title);
                                result.put("html", html);
                                finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                    result, null);
                            } catch (Exception error) {
                                finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                                    null, "อ่านเนื้อหาบทถัดไปไม่สำเร็จ");
                            }
                        });
                    } catch (Exception ignored) {
                        handler.postDelayed(this, 500);
                    }
                });
            }
        };

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                stablePolls[0] = 0;
                lastSignature[0] = "";
                handler.removeCallbacks(pollTask[0]);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                handler.removeCallbacks(pollTask[0]);
                handler.postDelayed(pollTask[0], 400);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    finishBackgroundPrefetch(call, webView, host, handler, pollTask[0], timeoutTask, finished,
                        null, "โหลดหน้าเว็บสำหรับดึงบทถัดไปไม่สำเร็จ");
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
            }
        });

        handler.postDelayed(timeoutTask, isManatokiUrl(targetUrl) ? 45000 : 25000);
        webView.loadUrl(targetUrl);
    }

    private boolean isManatokiUrl(String url) {
        try {
            String host = android.net.Uri.parse(url).getHost();
            return host != null && host.toLowerCase(Locale.ROOT).matches("manatoki\\d*\\.org");
        } catch (Exception ignored) {
            return false;
        }
    }

    private interface ManatokiExtractionCallback {
        void onComplete(JSONObject result);
    }

    private JSONObject manatokiFailure(String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);
            result.put("error", message);
        } catch (Exception ignored) {
            // JSONObject construction is best-effort; callers still handle malformed results.
        }
        return result;
    }

    private void runManatokiExtractor(
        WebView webView,
        Handler handler,
        boolean[] finished,
        ManatokiExtractionCallback callback
    ) {
        final String script;
        try {
            script = loadManatokiExtractorScript();
        } catch (Exception assetError) {
            callback.onComplete(manatokiFailure("โหลดตัวถอดรหัส Manatoki ไม่สำเร็จ"));
            return;
        }

        webView.evaluateJavascript(script, ignored -> {
            if (finished[0]) return;
            final int[] attempts = { 0 };
            final Runnable[] pollTask = { null };
            pollTask[0] = () -> {
                if (finished[0]) return;
                webView.evaluateJavascript(
                    "(function(){return window.__ncManatokiPending ? null : (window.__ncManatokiResult || null);})()",
                    value -> {
                        if (finished[0]) return;
                        if (value == null || "null".equals(value)) {
                            attempts[0]++;
                            if (attempts[0] >= 150) {
                                callback.onComplete(manatokiFailure("หมดเวลารอ API และการถอดรหัส Manatoki"));
                            } else {
                                handler.postDelayed(pollTask[0], 200);
                            }
                            return;
                        }
                        try {
                            Object decoded = new JSONTokener(value).nextValue();
                            callback.onComplete(new JSONObject(String.valueOf(decoded)));
                        } catch (Exception parseError) {
                            callback.onComplete(manatokiFailure("อ่านผลการถอดรหัส Manatoki ไม่สำเร็จ"));
                        }
                    }
                );
            };
            handler.postDelayed(pollTask[0], 100);
        });
    }

    private String loadManatokiExtractorScript() throws Exception {
        try (InputStream input = getContext().getAssets().open("manatoki-extractor.js");
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void finishBackgroundPrefetch(
        PluginCall call,
        WebView webView,
        ViewGroup host,
        Handler handler,
        Runnable pollTask,
        Runnable timeoutTask,
        boolean[] finished,
        JSObject result,
        String error
    ) {
        if (finished[0]) return;
        finished[0] = true;
        handler.removeCallbacks(pollTask);
        if (timeoutTask != null) handler.removeCallbacks(timeoutTask);
        CookieManager.getInstance().flush();
        if (webView.getParent() instanceof ViewGroup) {
            ((ViewGroup) webView.getParent()).removeView(webView);
        }
        webView.stopLoading();
        webView.destroy();
        call.setKeepAlive(false);
        if (error != null) call.reject(error);
        else call.resolve(result);
    }

    private void showBrowser(PluginCall call, String targetUrl, boolean expandToc) {
        Dialog dialog = new Dialog(getActivity());
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        LinearLayout root = new LinearLayout(getActivity());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        TextView status = new TextView(getActivity());
        status.setText("กำลังเปิดเว็บไซต์ต้นทาง… หากพบ CAPTCHA ให้ยืนยันในหน้านี้ เมื่อเห็นเนื้อหาบทแล้วจึงกดส่งเนื้อหา");
        status.setTextColor(Color.DKGRAY);
        status.setTextSize(13);
        status.setPadding(16, 12, 16, 12);
        root.addView(status, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        WebView webView = new WebView(getActivity());
        webView.setBackgroundColor(Color.WHITE);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setLoadsImagesAutomatically(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebChromeClient(new WebChromeClient());

        final boolean[] finished = { false };
        final boolean[] captureInProgress = { false };
        final Handler handler = new Handler(Looper.getMainLooper());
        final String[] lastSignature = { "" };
        final int[] stablePolls = { 0 };
        final boolean[] challengeSeen = { false };
        final long[] challengeClearedAt = { 0L };
        final int[] navigationId = { 0 };
        final JSONArray capturedTocPages = new JSONArray();
        final Set<String> visitedTocPages = new HashSet<>();
        visitedTocPages.add(targetUrl);
        final Runnable[] pollTask = { null };

        LinearLayout actions = new LinearLayout(getActivity());
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(12, 8, 12, 12);

        Button sendButton = new Button(getActivity());
        sendButton.setText("ยืนยันสารบัญและส่งเข้าแอป");
        sendButton.setEnabled(false);
        actions.addView(sendButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        Button closeButton = new Button(getActivity());
        closeButton.setText("ปิด");
        actions.addView(closeButton, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        root.addView(webView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1
        ));
        root.addView(actions);

        dialog.setContentView(root);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.MATCH_PARENT
            );
            window.setBackgroundDrawableResource(android.R.color.white);
        }

        sendButton.setOnClickListener(v -> extractPage(call, webView, dialog, status, finished, captureInProgress, handler, pollTask[0], expandToc, capturedTocPages, visitedTocPages));
        closeButton.setOnClickListener(v -> {
            if (!finished[0]) {
                finished[0] = true;
                call.setKeepAlive(false);
                call.reject("ยกเลิกการอ่านหน้าเว็บ");
            }
            dialog.dismiss();
        });

        pollTask[0] = new Runnable() {
            @Override
            public void run() {
                if (finished[0] || captureInProgress[0] || !dialog.isShowing()) return;
                final int currentNavigation = navigationId[0];
                String probeScript = "(()=>{const expandToc="+expandToc+";let moreLoading=false;if(expandToc){const nodes=[...document.querySelectorAll('button,a,[role=button],.more,.show-all,.all-chapters')];for(const el of nodes){const txt=(el.innerText||el.textContent||'').replace(/\\s+/g,'').trim();if(!txt||el.dataset.ncExpandedOnce==='1')continue;if(/全部章节|查看全部章节|展开全部|显示全部|全部展开|展开目录|查看目录/.test(txt)){el.dataset.ncExpandedOnce='1';el.click();break;}}for(const el of nodes){const txt=(el.innerText||el.textContent||'').replace(/\\s+/g,'').trim();if(!/加载更多|显示更多|展开更多|更多章节/.test(txt))continue;const rect=el.getBoundingClientRect();if(rect.width>0&&rect.height>0&&getComputedStyle(el).display!=='none'){const count=Number(el.dataset.ncLoadMoreCount||'0');if(count<30){moreLoading=true;el.dataset.ncLoadMoreCount=String(count+1);el.click();}break;}}}const b=document.body?document.body.innerText:'';const h=document.documentElement?document.documentElement.innerHTML:'';const t=document.title||'';const u=location.href;const hl=h.toLowerCase();const challenge=u.toLowerCase().includes('/cdn-cgi/challenge-platform/')||hl.includes('__cf_chl_')||hl.includes('cf-browser-verification')||!!document.querySelector('#challenge-form,#challenge-running,.cf-challenge,[data-cf-challenge]')||b.includes('正在验证浏览器')||b.includes('检查您是否为机器人')||b.includes('检查您不是机器人')||b.includes('ตรวจสอบว่าคุณไม่ใช่บอต')||b.includes('กำลังตรวจสอบว่าคุณไม่ใช่บอต');const sig=u+'|'+t+'|'+b.length+'|'+h.length+'|'+b.slice(-180);return JSON.stringify({ready:document.readyState==='complete',challenge:challenge,bodyLength:b.trim().length,htmlLength:h.length,signature:sig,moreLoading:moreLoading})})()";
                webView.evaluateJavascript(probeScript, value -> {
                    if (finished[0] || captureInProgress[0] || currentNavigation != navigationId[0]) return;
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        JSONObject probe = new JSONObject(String.valueOf(decoded));
                        if (probe.optBoolean("challenge", true)) {
                            challengeSeen[0] = true;
                            challengeClearedAt[0] = 0L;
                            stablePolls[0] = 0;
                            lastSignature[0] = "";
                            status.setText("พบหรือกำลังตรวจสอบ CAPTCHA — กรุณายืนยันให้ผ่าน ระบบจะรอเนื้อหาโหลดก่อนดึงให้อัตโนมัติ");
                        } else if (probe.optBoolean("moreLoading") || !probe.optBoolean("ready") || probe.optInt("bodyLength") < 180 || probe.optInt("htmlLength") < 1000) {
                            stablePolls[0] = 0;
                            lastSignature[0] = "";
                            status.setText(expandToc ? "กำลังขยายรายการตอนทั้งหมดและรอให้โหลดครบ…" : "ผ่านหน้าตรวจสอบแล้ว — กำลังรอเนื้อหาบทโหลดให้ครบ…");
                        } else {
                            if (challengeSeen[0]) {
                                if (challengeClearedAt[0] == 0L) challengeClearedAt[0] = System.currentTimeMillis();
                                if (System.currentTimeMillis() - challengeClearedAt[0] < 2000L) {
                                    stablePolls[0] = 0;
                                    lastSignature[0] = "";
                                    status.setText("ผ่าน CAPTCHA แล้ว — กำลังรอเนื้อหาโหลดเพิ่มอีก 2 วินาที…");
                                    handler.postDelayed(this, 350);
                                    return;
                                }
                            }
                            String signature = probe.optString("signature", "");
                            if (signature.equals(lastSignature[0])) {
                                stablePolls[0]++;
                            } else {
                                lastSignature[0] = signature;
                                stablePolls[0] = 1;
                            }
                            if (stablePolls[0] >= 3) {
                                sendButton.setEnabled(true);
                                status.setText(expandToc
                                    ? "หน้าเว็บพร้อมแล้ว — ตรวจสอบสารบัญ เลื่อนหน้าเว็บหรือกดขยายรายการตอนให้ครบ จากนั้นกดยืนยันสารบัญ"
                                    : "หน้าเว็บพร้อมแล้ว — ตรวจสอบเนื้อหา จากนั้นกดยืนยันเพื่อส่งเข้าแอป");
                            } else {
                                sendButton.setEnabled(false);
                                status.setText(expandToc ? "กำลังตรวจสอบความพร้อมของสารบัญ (" + stablePolls[0] + "/3)" : "กำลังเตรียมหน้าเว็บ…");
                            }
                        }
                    } catch (Exception ignored) {
                        stablePolls[0] = 0;
                    }
                    handler.postDelayed(this, expandToc ? 1200 : 350);
                });
            }
        };

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                navigationId[0]++;
                stablePolls[0] = 0;
                lastSignature[0] = "";
                handler.removeCallbacks(pollTask[0]);
                sendButton.setEnabled(false);
                status.setText("กำลังโหลดหน้าเว็บและตรวจสอบ CAPTCHA…");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                status.setText("กำลังตรวจสอบหน้าเว็บ — รอให้สารบัญโหลดครบก่อนยืนยัน");
                sendButton.setEnabled(false);
                handler.removeCallbacks(pollTask[0]);
                handler.postDelayed(pollTask[0], expandToc ? 1200 : 300);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                return !("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
            }
        });

        dialog.setOnDismissListener(ignored -> {
            if (!finished[0]) {
                finished[0] = true;
                call.setKeepAlive(false);
                call.reject("ปิดหน้าต่างอ่านเว็บก่อนส่งเนื้อหา");
            }
            handler.removeCallbacks(pollTask[0]);
            // Android WebView's CookieManager keeps cookies isolated by domain and persists them
            // in the app's WebView profile. Flush on close as well as after page loads/capture.
            CookieManager.getInstance().flush();
            webView.destroy();
        });

        dialog.show();
        if (window != null) {
            window.setLayout(
                getActivity().getResources().getDisplayMetrics().widthPixels,
                getActivity().getResources().getDisplayMetrics().heightPixels
            );
        }
        webView.loadUrl(targetUrl);
    }

    private void extractPage(
        PluginCall call,
        WebView webView,
        Dialog dialog,
        TextView status,
        boolean[] finished,
        boolean[] captureInProgress,
        Handler handler,
        Runnable pollRunnable,
        boolean expandToc,
        JSONArray capturedTocPages,
        Set<String> visitedTocPages
    ) {
        if (finished[0] || captureInProgress[0]) return;
        captureInProgress[0] = true;
        status.setText("กำลังตรวจสอบหน้าเว็บ…");
        String script = "(()=>{const root=document.documentElement?document.documentElement.cloneNode(true):null;if(root)root.querySelectorAll('script,style,noscript').forEach(node=>node.remove());let nextUrl='';if("+expandToc+"){const norm=s=>(s||'').replace(/\\s+/g,'').trim().toLowerCase();const pagerSelectors='[class*=pagination],[id*=pagination],[class*=pager],[id*=pager],[class*=pages],[id*=pages],[class*=page-list],[id*=page-list]';const pagers=[...document.querySelectorAll(pagerSelectors)];for(const box of pagers){const current=box.querySelector('.active,.current,.on,[aria-current=page]');if(current){let sibling=current.nextElementSibling;while(sibling&&!sibling.querySelector('a')&&sibling.tagName!=='A')sibling=sibling.nextElementSibling;const a=sibling?(sibling.matches('a')?sibling:sibling.querySelector('a')):null;if(a&&a.href){nextUrl=a.href;break;}}}if(!nextUrl){const links=[...document.querySelectorAll('a[href]')];const a=links.find(el=>{const t=norm(el.innerText||el.textContent);const rel=norm(el.getAttribute('rel'));const inPager=!!el.closest(pagerSelectors);return rel==='next'||(inPager&&/^(下一页|下页|下一頁|後頁|后页|next|›|»|>)$/.test(t));});if(a)nextUrl=a.href;}if(nextUrl){try{const n=new URL(nextUrl,location.href);if(n.origin!==location.origin||n.href===location.href)nextUrl='';else nextUrl=n.href;}catch(e){nextUrl='';}}}return JSON.stringify({title:document.title||'',url:location.href,html:root?('<!doctype html>'+root.outerHTML):'',bodyText:document.body?document.body.innerText:'',nextUrl:nextUrl})})()";
        webView.evaluateJavascript(script, value -> {
            if (finished[0]) return;
            if (value == null || "null".equals(value)) {
                captureInProgress[0] = false;
                status.setText("ยังอ่านหน้าเว็บไม่ได้ กำลังลองตรวจสอบอีกครั้ง…");
                handler.postDelayed(pollRunnable, 1200);
                return;
            }
            try {
                Object decoded = new JSONTokener(value).nextValue();
                JSONObject page = new JSONObject(String.valueOf(decoded));
                String html = page.optString("html", "");
                String bodyText = page.optString("bodyText", "");
                String title = page.optString("title", "");
                String pageUrl = page.optString("url", "");
                String nextUrl = page.optString("nextUrl", "");
                String lowerText = bodyText.toLowerCase(Locale.ROOT);
                String lowerHtml = html.toLowerCase(Locale.ROOT);
                String lowerTitle = title.toLowerCase(Locale.ROOT);
                String lowerUrl = pageUrl.toLowerCase(Locale.ROOT);

                // Keep native capture aligned with the server classifier. Natural-language
                // phrases and an embedded Turnstile widget are not proof that the whole
                // page is a challenge; only challenge-page markers or explicit challenge text are.
                boolean challenge = lowerUrl.contains("/cdn-cgi/challenge-platform/")
                    || lowerHtml.contains("__cf_chl_")
                    || lowerHtml.contains("cf-browser-verification")
                    || lowerHtml.contains("id=\"challenge-form\"")
                    || lowerHtml.contains("id='challenge-form'")
                    || lowerHtml.contains("id=\"challenge-running\"")
                    || lowerHtml.contains("class=\"cf-challenge")
                    || lowerHtml.contains("data-cf-challenge")
                    || bodyText.contains("正在验证浏览器")
                    || bodyText.contains("检查您是否为机器人")
                    || bodyText.contains("检查您不是机器人")
                    || bodyText.contains("ตรวจสอบว่าคุณไม่ใช่บอต")
                    || bodyText.contains("กำลังตรวจสอบว่าคุณไม่ใช่บอต");

                if (challenge) {
                    captureInProgress[0] = false;
                    status.setText("ยังเป็นหน้าตรวจสอบของเว็บไซต์ — กรุณาทำ CAPTCHA ให้ผ่าน ระบบจะลองดึงเนื้อหาให้อัตโนมัติ");
                    handler.postDelayed(pollRunnable, 1200);
                    return;
                }
                if (html.length() < 300 || bodyText.trim().length() < 80) {
                    captureInProgress[0] = false;
                    status.setText("ยังไม่พบเนื้อหาบทที่สมบูรณ์ ลองรอให้หน้าเว็บโหลดเพิ่ม หรือกดส่งเนื้อหาเอง");
                    handler.postDelayed(pollRunnable, 1200);
                    return;
                }

                CookieManager.getInstance().flush();
                if (!expandToc && isManatokiUrl(pageUrl)) {
                    status.setText("กำลังเรียก API และถอดรหัสเนื้อหา Manatoki…");
                    runManatokiExtractor(webView, handler, finished, extraction -> {
                        if (finished[0]) return;
                        try {
                            if (!extraction.optBoolean("ok")) {
                                captureInProgress[0] = false;
                                status.setText("ดึงเนื้อหา Manatoki ไม่สำเร็จ: "
                                    + extraction.optString("error", "ไม่ทราบสาเหตุ"));
                                handler.postDelayed(pollRunnable, 1200);
                                return;
                            }
                            String extractedHtml = extraction.optString("html", "");
                            String extractedTitle = extraction.optString("title", title);
                            String extractedUrl = extraction.optString("url", pageUrl);
                            if (extractedHtml.length() < 100 || !extractedHtml.contains("reader-content")) {
                                captureInProgress[0] = false;
                                status.setText("ถอดรหัส Manatoki แล้วแต่ไม่พบเนื้อหาที่อ่านได้");
                                handler.postDelayed(pollRunnable, 1200);
                                return;
                            }
                            finished[0] = true;
                            call.setKeepAlive(false);
                            JSObject result = new JSObject();
                            result.put("url", extractedUrl);
                            result.put("title", extractedTitle);
                            result.put("html", extractedHtml);
                            call.resolve(result);
                            dialog.dismiss();
                        } catch (Exception extractionError) {
                            captureInProgress[0] = false;
                            status.setText("อ่านผลการถอดรหัส Manatoki ไม่สำเร็จ");
                            handler.postDelayed(pollRunnable, 1200);
                        }
                    });
                    return;
                }
                if (expandToc) {
                    capturedTocPages.put(new JSONObject().put("url", pageUrl).put("title", title).put("html", html));
                    if (!nextUrl.isEmpty() && !visitedTocPages.contains(nextUrl) && capturedTocPages.length() < 50) {
                        visitedTocPages.add(nextUrl);
                        captureInProgress[0] = false;
                        status.setText("เก็บสารบัญแล้ว " + capturedTocPages.length() + " หน้า — กำลังเปิดหน้าถัดไปอัตโนมัติ…");
                        webView.loadUrl(nextUrl);
                        return;
                    }
                }
                finished[0] = true;
                call.setKeepAlive(false);
                JSObject result = new JSObject();
                if (expandToc && capturedTocPages.length() > 0) {
                    JSONObject firstPage = capturedTocPages.optJSONObject(0);
                    result.put("url", firstPage != null ? firstPage.optString("url", pageUrl) : pageUrl);
                    result.put("title", firstPage != null ? firstPage.optString("title", title) : title);
                    result.put("html", firstPage != null ? firstPage.optString("html", html) : html);
                    result.put("pages", capturedTocPages);
                } else {
                    result.put("url", pageUrl);
                    result.put("title", title);
                    result.put("html", html);
                }
                call.resolve(result);
                dialog.dismiss();
            } catch (Exception error) {
                captureInProgress[0] = false;
                status.setText("อ่านหน้าเว็บไม่สำเร็จ — ระบบจะลองอีกครั้ง หรือกดส่งเนื้อหาเองได้");
                handler.postDelayed(pollRunnable, 1200);
            }
        });
    }

    /**
     * Temporary network inspector for diagnosing JavaScript-rendered chapter pages.
     * Captures same-origin fetch/XHR text responses only; it does not alter page responses.
     */
    @PluginMethod
    public void debugNetwork(PluginCall call) {
        String targetUrl = call.getString("url");
        if (targetUrl == null || !(targetUrl.startsWith("https://") || targetUrl.startsWith("http://"))) {
            call.reject("URL ไม่ถูกต้อง");
            return;
        }
        final android.net.Uri target = android.net.Uri.parse(targetUrl);
        final String origin = target.getScheme() + "://" + target.getAuthority();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            call.reject("Android System WebView รุ่นนี้ยังไม่รองรับการตรวจ Network แบบเริ่มก่อน JavaScript");
            return;
        }
        call.setKeepAlive(true);
        getActivity().runOnUiThread(() -> {
            Dialog dialog = new Dialog(getActivity());
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            LinearLayout root = new LinearLayout(getActivity());
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(Color.WHITE);

            TextView status = new TextView(getActivity());
            status.setText("กำลังเตรียม Network Inspector…");
            status.setTextColor(Color.DKGRAY);
            status.setTextSize(12);
            status.setPadding(12, 8, 12, 8);
            root.addView(status, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ));

            WebView webView = new WebView(getActivity());
            webView.setBackgroundColor(Color.WHITE);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setAllowFileAccess(false);
            webView.getSettings().setAllowContentAccess(false);
            webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);

            TextView logsView = new TextView(getActivity());
            logsView.setTextColor(Color.BLACK);
            logsView.setTextSize(10);
            logsView.setPadding(10, 8, 10, 8);
            logsView.setText("ยังไม่มี Fetch/XHR response ที่ตรวจพบ");
            logsView.setBackgroundColor(0xFFF3F4F6);
            ScrollView logScroll = new ScrollView(getActivity());
            logScroll.addView(logsView);
            root.addView(webView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.0f
            ));
            root.addView(logScroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.8f
            ));

            LinearLayout actions = new LinearLayout(getActivity());
            actions.setOrientation(LinearLayout.HORIZONTAL);
            actions.setGravity(Gravity.CENTER);
            actions.setPadding(6, 4, 6, 8);
            Button reloadButton = new Button(getActivity());
            reloadButton.setText("โหลดใหม่");
            actions.addView(reloadButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            Button inspectButton = new Button(getActivity());
            inspectButton.setText("ตรวจ DOM");
            actions.addView(inspectButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            Button clearButton = new Button(getActivity());
            clearButton.setText("ล้าง");
            actions.addView(clearButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            Button copyButton = new Button(getActivity());
            copyButton.setText("คัดลอก Log");
            actions.addView(copyButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            Button closeButton = new Button(getActivity());
            closeButton.setText("ปิด");
            actions.addView(closeButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
            root.addView(actions);

            dialog.setContentView(root);
            Window window = dialog.getWindow();
            if (window != null) {
                window.setLayout(
                    getActivity().getResources().getDisplayMetrics().widthPixels,
                    getActivity().getResources().getDisplayMetrics().heightPixels
                );
                window.setBackgroundDrawableResource(android.R.color.white);
            }

            final StringBuilder capturedLogs = new StringBuilder();
            final int[] eventCount = { 0 };
            final boolean[] finished = { false };
            final String prefix = "__NC_NET__";
            final String hook = "(function(){if(window.__ncNetworkHooked)return;window.__ncNetworkHooked=true;" +
                "const emit=x=>{try{console.log('" + prefix + "'+JSON.stringify(x))}catch(e){}};" +
                "const same=u=>{try{return new URL(u,location.href).origin===location.origin}catch(e){return false}};" +
                "const originalFetch=window.fetch;" +
                "if(originalFetch)window.fetch=function(){const args=arguments;const req=args[0];const init=args[1]||{};" +
                "const url=typeof req==='string'?req:(req&&req.url)||'';const method=init.method||(req&&req.method)||'GET';" +
                "return originalFetch.apply(this,args).then(response=>{try{const copy=response.clone();const type=copy.headers.get('content-type')||'';" +
                "if(same(url)&&(/json|text|xml|javascript/i.test(type))){copy.text().then(body=>emit({kind:'fetch',url:copy.url||url,method,status:copy.status,type,length:body.length,body:body.slice(0,12000)})).catch(()=>{});}" +
                "}catch(e){}return response;});};" +
                "const xo=XMLHttpRequest.prototype.open;const xs=XMLHttpRequest.prototype.send;" +
                "XMLHttpRequest.prototype.open=function(method,url){this.__ncMeta={method:method||'GET',url:String(url||'')};return xo.apply(this,arguments)};" +
                "XMLHttpRequest.prototype.send=function(){this.addEventListener('loadend',function(){try{const m=this.__ncMeta||{};const type=this.getResponseHeader('content-type')||'';" +
                "if(same(m.url)&&(/json|text|xml|javascript/i.test(type))&&(this.responseType===''||this.responseType==='text')){" +
                "const body=this.responseText||'';emit({kind:'xhr',url:new URL(m.url,location.href).href,method:m.method,status:this.status,type,length:body.length,body:body.slice(0,12000)});}}catch(e){}},{once:true});" +
                "return xs.apply(this,arguments)};emit({kind:'hook-ready',url:location.href});})();";
            WebViewCompat.addDocumentStartJavaScript(webView, hook, java.util.Collections.singleton(origin));
            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onConsoleMessage(ConsoleMessage message) {
                    String value = message.message();
                    if (value == null || !value.startsWith(prefix)) return true;
                    String payload = value.substring(prefix.length());
                    try {
                        JSONObject event = new JSONObject(payload);
                        String kind = event.optString("kind", "event");
                        String url = event.optString("url", "");
                        String line;
                        if ("hook-ready".equals(kind)) {
                            line = "[HOOK] " + url;
                        } else {
                            line = "[" + kind.toUpperCase(Locale.ROOT) + " " + event.optInt("status") + "] "
                                + event.optString("method") + " " + url
                                + "\nContent-Type: " + event.optString("type")
                                + " · " + event.optInt("length") + " chars\n"
                                + event.optString("body", "");
                        }
                        if (capturedLogs.length() > 500000) {
                            capturedLogs.setLength(0);
                            capturedLogs.append("[older logs truncated]\n");
                        }
                        capturedLogs.append(line).append("\n\n");
                        eventCount[0]++;
                        String shown = capturedLogs.toString();
                        logsView.setText(shown);
                        status.setText("จับเหตุการณ์ได้ " + eventCount[0] + " รายการ · ตรวจเฉพาะ Fetch/XHR ของ origin เดียวกัน");
                        logScroll.post(() -> logScroll.fullScroll(View.FOCUS_DOWN));
                    } catch (Exception ignored) {
                        capturedLogs.append(payload).append("\n");
                    }
                    return true;
                }
            });
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                    status.setText("กำลังโหลด: " + url);
                }
                @Override
                public void onPageFinished(WebView view, String url) {
                    status.setText("หน้าเว็บโหลดแล้ว · รอ Response จาก Fetch/XHR");
                }
            });
            reloadButton.setOnClickListener(v -> webView.reload());
            inspectButton.setOnClickListener(v -> {
                String inspectScript = "(()=>{const b=document.body;const e=document.querySelector('article,.chapter-content,.entry-content,.content,.reading-content,#content')||b;const sample=(e?.innerText||'').slice(0,5000);const raw=(e?.textContent||'').slice(0,5000);const el=e?.querySelector('*')||e;const cs=el?getComputedStyle(el):null;const styles=[...document.styleSheets].map(x=>x.href||'inline').slice(0,80);const scripts=[...document.scripts].map(x=>x.src||'inline').slice(0,80);const fonts=[...document.fonts].map(x=>({family:x.family,status:x.status,weight:x.weight})).slice(0,80);return JSON.stringify({kind:'dom-snapshot',url:location.href,title:document.title,readyState:document.readyState,bodyInnerText:(b?.innerText||'').slice(0,5000),bodyTextContent:(b?.textContent||'').slice(0,5000),contentInnerText:sample,contentTextContent:raw,contentHTML:(e?.innerHTML||'').slice(0,8000),fontFamily:cs?.fontFamily,fontSize:cs?.fontSize,stylesheets:styles,scripts:scripts,fonts:fonts,selection:String(getSelection()||'').slice(0,2000)})})()";
                webView.evaluateJavascript(inspectScript, value -> {
                    try {
                        Object decoded = new JSONTokener(value).nextValue();
                        JSONObject snapshot = new JSONObject(String.valueOf(decoded));
                        String line = "[DOM SNAPSHOT]\n" + snapshot.toString(2);
                        if (capturedLogs.length() > 500000) capturedLogs.setLength(0);
                        capturedLogs.append(line).append("\n\n");
                        logsView.setText(capturedLogs.toString());
                        status.setText("เพิ่ม DOM Snapshot แล้ว · คัดลอก Log เพื่อตรวจ");
                        logScroll.post(() -> logScroll.fullScroll(View.FOCUS_DOWN));
                    } catch (Exception error) {
                        status.setText("อ่าน DOM Snapshot ไม่สำเร็จ");
                    }
                });
            });
            clearButton.setOnClickListener(v -> {
                capturedLogs.setLength(0);
                eventCount[0] = 0;
                logsView.setText("ล้าง Log แล้ว");
                status.setText("ล้าง Log แล้ว · กำลังรอ Request");
            });
            copyButton.setOnClickListener(v -> {
                android.content.ClipboardManager clipboard = (android.content.ClipboardManager) getActivity()
                    .getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                if (clipboard != null) {
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Novel Crawler Network Log", capturedLogs.toString()));
                    status.setText("คัดลอก Log แล้ว");
                }
            });
            closeButton.setOnClickListener(v -> {
                if (!finished[0]) {
                    finished[0] = true;
                    call.setKeepAlive(false);
                    call.resolve();
                }
                dialog.dismiss();
            });
            dialog.setOnDismissListener(v -> {
                if (!finished[0]) {
                    finished[0] = true;
                    call.setKeepAlive(false);
                    call.resolve();
                }
                webView.stopLoading();
                webView.destroy();
            });
            dialog.show();
            webView.loadUrl(targetUrl);
        });
    }

}
