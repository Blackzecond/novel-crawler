import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

if (process.env.CI === 'true' && !serverUrl) {
  throw new Error('CAPACITOR_SERVER_URL is required when building the Android wrapper.');
}

const config: CapacitorConfig = {
  appId: 'com.blackzecond.novelcrawler',
  appName: 'Novel Crawler',
  webDir: 'www',
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: false,
        allowNavigation: [new URL(serverUrl).hostname],
      }
    : undefined,
  android: {
    allowMixedContent: false,
  },
};

export default config;
