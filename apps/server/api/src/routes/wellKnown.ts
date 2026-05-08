import { Hono, type Context } from 'hono';
import { getEnv } from '../env.js';

const IOS_BUNDLE_ID = 'app.flipturn.mobile';
const ANDROID_PACKAGE_NAME = 'app.flipturn.mobile';
const APPLINK_PATH_PATTERN = '/auth*';

/**
 * Routes mounted at `/.well-known/*` for Universal Links / App Links.
 *
 * Apple downloads `apple-app-site-association` (no extension, served as
 * `application/json`) from the apex on app install / first link click.
 * Android downloads `assetlinks.json` similarly. When `IOS_TEAM_ID` /
 * `ANDROID_CERT_SHA256` are unset, both endpoints still return valid
 * manifests with empty associations — preferable to 404 because OS-level
 * caches (Apple's CDN especially) treat 404 as "no association ever",
 * sometimes for hours.
 */
export function wellKnownRoutes(): Hono {
  const r = new Hono();
  r.get('/apple-app-site-association', appleAppSiteAssociation);
  r.get('/assetlinks.json', assetlinks);
  return r;
}

function appleAppSiteAssociation(c: Context): Response {
  const teamId = getEnv().IOS_TEAM_ID.trim();
  const details = teamId
    ? [
        {
          appIDs: [`${teamId}.${IOS_BUNDLE_ID}`],
          components: [{ '/': APPLINK_PATH_PATTERN }],
        },
      ]
    : [];
  return c.json({ applinks: { details } });
}

function assetlinks(c: Context): Response {
  const fingerprints = getEnv()
    .ANDROID_CERT_SHA256.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fingerprints.length === 0) {
    return c.json([]);
  }
  return c.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}
