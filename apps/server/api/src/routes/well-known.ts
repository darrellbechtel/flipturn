import { Hono } from 'hono';

const APP_BUNDLE_ID = 'app.flipturn.mobile';

export interface WellKnownDeps {
  readonly iosAppTeamId?: string | undefined;
  readonly androidAppSha256?: string | undefined;
}

export function wellKnownRoutes(deps: WellKnownDeps): Hono {
  const r = new Hono();

  // iOS Universal Links — apple-app-site-association
  // Apple's docs say MIME type must be application/json (not application/pkcs7).
  r.get('/apple-app-site-association', (c) => {
    if (!deps.iosAppTeamId) {
      return c.notFound();
    }
    return c.json({
      applinks: {
        apps: [],
        details: [
          {
            appID: `${deps.iosAppTeamId}.${APP_BUNDLE_ID}`,
            paths: ['/auth*'],
          },
        ],
      },
    });
  });

  // Android App Links — assetlinks.json
  r.get('/assetlinks.json', (c) => {
    if (!deps.androidAppSha256) {
      return c.notFound();
    }
    return c.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: APP_BUNDLE_ID,
          sha256_cert_fingerprints: [deps.androidAppSha256],
        },
      },
    ]);
  });

  return r;
}
