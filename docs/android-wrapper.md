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

## Important current scope

This first stage only creates the Android container and remote app loading. It does not yet implement the separate source-site WebView, DOM extraction bridge, automatic fetch fallback, or persistent source-site sessions. Those require a dedicated native Android plugin and will be added in later stages.

The source-site session must remain in Android's app-private WebView cookie store and must never be copied into Supabase or sent to the Next.js server.
