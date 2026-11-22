import type { CapacitorConfig } from '@capacitor/cli';

const rawServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

if (process.env.CI === 'true' && !rawServerUrl) {
  throw new Error('CAPACITOR_SERVER_URL is required when building the Android wrapper.');
}

const serverUrl = rawServerUrl
  ? (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawServerUrl) ? rawServerUrl : `https://${rawServerUrl}`)
  : undefined;

const parsedServerUrl = serverUrl ? new URL(serverUrl) : undefined;

if (parsedServerUrl && !['https:', 'http:'].includes(parsedServerUrl.protocol)) {
  throw new Error('CAPACITOR_SERVER_URL must use http:// or https://.');
}

const config: CapacitorConfig = {
  appId: 'com.blackzecond.novelcrawler',
  appName: 'Novel Crawler',
  webDir: 'www',
  server: parsedServerUrl
    ? {
        url: parsedServerUrl.origin + parsedServerUrl.pathname.replace(/\\/$/, ''),
        cleartext: false,
        allowNavigation: [parsedServerUrl.hostname],
      }
    : undefined,
  android: {
    allowMixedContent: false,
  },
};

export default config;
