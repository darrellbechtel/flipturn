// HTML rendered by GET /v1/auth/magic-link/consume?token=...
//
// We do **not** auto-consume the token on GET. Email scanners, link previewers
// (Slack, iMessage, Outlook safe-link rewriters, etc.) routinely prefetch URLs
// to render unfurls, and consuming on a prefetch would burn the token before
// the human ever clicks. The page reads `?token=` from `window.location.search`
// purely client-side and only POSTs when the user clicks "Sign in".
//
// On success the response includes the session token; we surface it for now
// because there is no web app yet to store it for the user. Once Phase 2/3
// (web app + Universal Links) lands, this can be replaced with a redirect or
// a "you're signed in, return to the app" message.
export const SIGN_IN_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Flip Turn — Sign in</title>
  <style>
    :root { color-scheme: light dark; --bg:#f5f7fa; --fg:#1f3d5c; --muted:#6b7d92; --card:#fff; --border:#d8e0eb; --btn:#1f3d5c; --btn-fg:#fff; }
    @media (prefers-color-scheme: dark) { :root { --bg:#0d1620; --fg:#dee7f1; --muted:#94a4b8; --card:#172230; --border:#2a3a4d; --btn:#5a8fc0; --btn-fg:#0d1620; } }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--fg); display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 1.5rem; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 2rem; max-width: 28rem; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    h1 { margin: 0 0 0.5rem; font-size: 1.5rem; }
    p { margin: 0 0 1.25rem; color: var(--muted); }
    button { display: block; width: 100%; padding: 0.75rem 1rem; font: inherit; font-weight: 600; background: var(--btn); color: var(--btn-fg); border: none; border-radius: 8px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    pre { margin: 1.25rem 0 0; padding: 0.75rem; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; white-space: pre-wrap; }
    .ok { color: #1d7f3a; }
    .err { color: #c0392b; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Flip Turn</h1>
    <p id="prompt">Click below to finish signing in.</p>
    <button id="sign-in" type="button">Sign in</button>
    <pre id="result" hidden></pre>
  </main>
  <script>
    (function () {
      var params = new URLSearchParams(window.location.search);
      var token = params.get('token');
      var btn = document.getElementById('sign-in');
      var prompt = document.getElementById('prompt');
      var out = document.getElementById('result');

      if (!token) {
        btn.disabled = true;
        prompt.textContent = 'Missing token in URL — request a new sign-in email.';
        return;
      }

      btn.addEventListener('click', function () {
        btn.disabled = true;
        prompt.textContent = 'Signing you in…';
        fetch('/v1/auth/magic-link/consume', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: token }),
        })
          .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
          .then(function (r) {
            out.hidden = false;
            if (r.ok && r.body && r.body.sessionToken) {
              prompt.innerHTML = '<span class="ok">Signed in.</span>';
              out.textContent = 'sessionToken: ' + r.body.sessionToken;
            } else {
              prompt.innerHTML = '<span class="err">Sign-in failed.</span>';
              out.textContent = JSON.stringify(r.body, null, 2);
              btn.disabled = false;
            }
          })
          .catch(function (e) {
            prompt.innerHTML = '<span class="err">Network error.</span>';
            out.hidden = false;
            out.textContent = String(e);
            btn.disabled = false;
          });
      });
    })();
  </script>
</body>
</html>`;
