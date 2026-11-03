# Android wrapper

Novel Crawler remains a Next.js web application. The Android APK is a Capacitor shell that loads the deployed web app URL in its native WebView.

## Build an APK without a local computer

1. Deploy the current web app to Vercel.
2. Open the repository's **Actions** tab on GitHub.
3. Select **Build Android APK** and choose **Run workflow**.
4. Enter the deployed app URL, including `https://`.
5. Wait for the workflow to finish.
6. Open the workflow run, download the `novel-crawler-debug-apk` artifact, extract it, and install `app-debug.apk` on Android.

The workflow currently creates a debug APK for personal installation. It does not sign a Play Store release.

## Source-site WebView fallback

On Android, TOC creation and chapter fetching first use the existing server-side fetch pipeline. If that request fails, the app opens the source URL in a separate in-app Android WebView. The WebView:

- Runs the source site's JavaScript and keeps its cookies in Android's app-private WebView cookie store.
- Allows the user to wait for or complete a site's CAPTCHA.
- Attempts to capture the rendered document automatically; if the page is still showing a challenge, the user can finish the check and tap **ส่งเนื้อหาเข้าแอป**.
- Sends the rendered HTML and final page URL to the existing TOC/chapter parser. The normal storage and chapter-cache flow remains unchanged.

After WebView succeeds for a project, the app remembers that project's preferred fetch method on that device and tries WebView first for its later chapters. This preference is local to the app; it is not written to Supabase. Cookies are never copied into Supabase or sent as cookie headers to the Next.js server.

The WebView only accepts HTTP(S) navigation. It is still possible for a site to block embedded WebViews, require repeated CAPTCHA checks, or change its page structure; this is a fallback, not a guarantee that every anti-bot system can be bypassed.

## Prototype limitation

The APK currently loads the deployed app using Capacitor's `server.url` setting. Capacitor documents this setting as a development/live-reload mechanism rather than a production deployment strategy. It is being used for the first personal prototype so the app can be built from GitHub Actions without a local computer; it should be replaced with a production-oriented shell/deployment arrangement before treating the APK as a stable release.
