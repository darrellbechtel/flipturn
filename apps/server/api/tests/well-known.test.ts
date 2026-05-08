import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { wellKnownRoutes } from '../src/routes/well-known.js';

function mountAt(deps: Parameters<typeof wellKnownRoutes>[0]): Hono {
  const app = new Hono();
  app.route('/.well-known', wellKnownRoutes(deps));
  return app;
}

describe('GET /.well-known/apple-app-site-association', () => {
  it('returns 404 when IOS_APP_TEAM_ID is unset', async () => {
    const app = mountAt({});
    const res = await app.request('/.well-known/apple-app-site-association');
    expect(res.status).toBe(404);
  });

  it('returns the AASA payload with the configured Team ID', async () => {
    const app = mountAt({ iosAppTeamId: 'ABCD123456' });
    const res = await app.request('/.well-known/apple-app-site-association');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as {
      applinks: { apps: string[]; details: Array<{ appID: string; paths: string[] }> };
    };
    expect(body.applinks.apps).toEqual([]);
    expect(body.applinks.details).toHaveLength(1);
    expect(body.applinks.details[0]?.appID).toBe('ABCD123456.app.flipturn.mobile');
    expect(body.applinks.details[0]?.paths).toEqual(['/auth*']);
  });
});

describe('GET /.well-known/assetlinks.json', () => {
  it('returns 404 when ANDROID_APP_SHA256 is unset', async () => {
    const app = mountAt({});
    const res = await app.request('/.well-known/assetlinks.json');
    expect(res.status).toBe(404);
  });

  it('returns the assetlinks payload with the configured SHA-256', async () => {
    const sha = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
    const app = mountAt({ androidAppSha256: sha });
    const res = await app.request('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Array<{
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }>;
    expect(body).toHaveLength(1);
    expect(body[0]?.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(body[0]?.target.namespace).toBe('android_app');
    expect(body[0]?.target.package_name).toBe('app.flipturn.mobile');
    expect(body[0]?.target.sha256_cert_fingerprints).toEqual([sha]);
  });
});
