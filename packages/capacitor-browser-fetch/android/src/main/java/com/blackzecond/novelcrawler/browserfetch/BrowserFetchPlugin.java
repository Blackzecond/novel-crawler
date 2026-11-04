package com.blackzecond.novelcrawler.browserfetch;

import android.app.Dialog;
import android.graphics.Color;
import android.view.Gravity;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.Locale;

@CapacitorPlugin(name = "BrowserFetch")
public class BrowserFetchPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String targetUrl = call.getString("url");
        if (targetUrl == null || !(targetUrl.startsWith("https://") || targetUrl.startsWith("http://"))) {
            call.reject("URL ไม่ถูกต้อง");
            return;
        }

        call.setKeepAlive(true);
        getActivity().runOnUiThread(() -> showBrowser(call, targetUrl));
    }

    private void showBrowser(PluginCall call, String targetUrl) {
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

        LinearLayout actions = new LinearLayout(getActivity());
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        actions.setPadding(12, 8, 12, 12);

        Button sendButton = new Button(getActivity());
        sendButton.setText("ส่งเนื้อหาเข้าแอป");
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

        sendButton.setOnClickListener(v -> extractPage(call, webView, dialog, status, finished));
        closeButton.setOnClickListener(v -> {
            if (!finished[0]) {
                finished[0] = true;
                call.setKeepAlive(false);
                call.reject("ยกเลิกการอ่านหน้าเว็บ");
            }
            dialog.dismiss();
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                status.setText("หน้าเว็บโหลดแล้ว — ตรวจสอบ CAPTCHA ให้ผ่านและรอจนเห็นเนื้อหาบท จากนั้นกดส่งเนื้อหา");
                sendButton.setEnabled(true);
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
        boolean[] finished
    ) {
        if (finished[0]) return;
        status.setText("กำลังตรวจสอบหน้าเว็บ…");
        String script = "(()=>{const root=document.documentElement?document.documentElement.cloneNode(true):null;if(root)root.querySelectorAll('script,style,noscript').forEach(node=>node.remove());return JSON.stringify({title:document.title||'',url:location.href,html:root?('<!doctype html>'+root.outerHTML):'',bodyText:document.body?document.body.innerText:''})})()";
        webView.evaluateJavascript(script, value -> {
            if (finished[0] || value == null || "null".equals(value)) {
                status.setText("ยังอ่านหน้าเว็บไม่ได้ ลองรอให้โหลดเสร็จแล้วกดอีกครั้ง");
                return;
            }
            try {
                Object decoded = new JSONTokener(value).nextValue();
                JSONObject page = new JSONObject(String.valueOf(decoded));
                String html = page.optString("html", "");
                String bodyText = page.optString("bodyText", "");
                String title = page.optString("title", "");
                String pageUrl = page.optString("url", "");
                String lowerText = bodyText.toLowerCase(Locale.ROOT);
                String lowerHtml = html.toLowerCase(Locale.ROOT);
                String lowerTitle = title.toLowerCase(Locale.ROOT);
                String lowerUrl = pageUrl.toLowerCase(Locale.ROOT);

                boolean challenge = lowerText.contains("just a moment")
                    || bodyText.contains("正在验证浏览器")
                    || lowerText.contains("verify you are human")
                    || lowerText.contains("performing security verification")
                    || lowerText.contains("checking your browser")
                    || lowerText.contains("checking if the site connection is secure")
                    || lowerTitle.contains("just a moment")
                    || lowerHtml.contains("cf-challenge")
                    || lowerHtml.contains("cf-chl-")
                    || lowerHtml.contains("challenge-platform")
                    || lowerUrl.contains("/cdn-cgi/challenge-platform/");

                if (challenge) {
                    status.setText("ยังเป็นหน้าตรวจสอบของเว็บไซต์ — กรุณาทำ CAPTCHA ให้ผ่านและรอจนเห็นเนื้อหาบทจริง แล้วค่อยกดส่งอีกครั้ง");
                    return;
                }
                if (html.length() < 300 || bodyText.trim().length() < 80) {
                    status.setText("ยังไม่พบเนื้อหาบทที่สมบูรณ์ ลองรอให้หน้าเว็บโหลดเพิ่มแล้วกดส่งอีกครั้ง");
                    return;
                }

                CookieManager.getInstance().flush();
                finished[0] = true;
                call.setKeepAlive(false);
                JSObject result = new JSObject();
                result.put("url", pageUrl);
                result.put("title", title);
                result.put("html", html);
                call.resolve(result);
                dialog.dismiss();
            } catch (Exception error) {
                status.setText("อ่านหน้าเว็บไม่สำเร็จ — ลองกดส่งเนื้อหาอีกครั้ง");
            }
        });
    }
}
