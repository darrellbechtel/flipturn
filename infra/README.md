# Flip Turn — production deployment runbook

This directory holds production-deploy configs for the Mac Mini host. Plan 6
introduced these; nothing here is referenced from the application code at
runtime — they're operational scaffolding.

The MVP target host is a Mac Mini on a residential network. Cloudflare Tunnel
exposes the API to mobile clients without opening home-network ports; pm2
supervises the API + workers + tunnel processes; Resend delivers magic-link
emails from a verified `flipturn.app` sending domain.

## Files

- `pm2/ecosystem.config.cjs` — pm2 process definitions for `flipturn-api`,
  `flipturn-workers`, and `flipturn-tunnel` (cloudflared)
- `cloudflared/config.yml` — Cloudflare Tunnel routing template
  (`<TUNNEL_UUID>` placeholders; the operator substitutes after
  `cloudflared tunnel create`)

## Secrets file (`~/.config/flipturn/secrets.env`)

pm2 loads production env vars from this file. Create it manually on the Mac
Mini — **never commit it.** The repo's root `.gitignore` already excludes
`.env` and `.env.*`; this file lives outside the repo entirely.

Required keys:

```bash
# Database — local Postgres via compose.dev.yaml
DATABASE_URL="postgresql://flipturn:<password>@localhost:55432/flipturn?schema=public"

# Redis — local Redis via compose.dev.yaml
REDIS_URL="redis://localhost:56379"

# Sentry — get the DSN from sentry.io (free tier; one project per service is fine)
SENTRY_DSN=""

# Resend — get from resend.com after verifying flipturn.app (see "Resend setup" below)
RESEND_API_KEY="re_..."
EMAIL_FROM="Flip Turn <noreply@flipturn.app>"

# API tuning
PORT=3000
BASE_URL="https://api.flipturn.app"
MOBILE_DEEP_LINK_BASE="https://flipturn.app/auth"  # Universal Links once enabled (Plan 6 Task 12)
LOG_LEVEL="info"

# Worker politeness
SCRAPE_USER_AGENT="FlipTurnBot/0.1 (+https://flipturn.app/bot; contact@flipturn.app)"
SCRAPE_RATE_LIMIT_MS=5000
SCRAPE_DAILY_HOST_BUDGET=500
ARCHIVE_DIR="/Users/darrell/flipturn-data/raw"
```

Permissions:

```bash
mkdir -p ~/.config/flipturn
chmod 700 ~/.config/flipturn
touch ~/.config/flipturn/secrets.env
chmod 600 ~/.config/flipturn/secrets.env
# ...then paste the keys above into the file.
```

`chmod 600` ensures only the deploying user can read it.

## First deploy

These steps run once per host. Subsequent deploys use the "Updating" section
below.

1. **Install Node 22 via nvm** (the repo's `.nvmrc` pins Node 22):

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
   # Restart the shell, then:
   nvm install 22
   nvm alias default 22
   corepack enable      # makes `pnpm` available
   ```

2. **Install pm2 globally:**

   ```bash
   npm install -g pm2
   ```

3. **Install cloudflared:**

   ```bash
   brew install cloudflared
   ```

4. **Clone the repo and install deps:**

   ```bash
   cd ~
   git clone https://github.com/<owner>/flipturn.git
   cd flipturn
   pnpm install
   ```

5. **Bring up Postgres + Redis** (the dev compose file is reused for prod —
   single-tenant residential host):

   ```bash
   pnpm dev:up
   ```

6. **Run migrations and (optionally) seed the Cochrane fixture for smoke testing:**

   ```bash
   pnpm db:migrate
   pnpm db:seed-fixture   # optional
   ```

7. **Create the secrets file** per the "Secrets file" section above.

8. **Set up the Cloudflare Tunnel:**

   ```bash
   cloudflared tunnel login                    # opens a browser for OAuth
   cloudflared tunnel create flipturn-prod     # prints the tunnel UUID + credentials path
   cloudflared tunnel route dns flipturn-prod api.flipturn.app
   ```

   Then copy the template config and substitute the UUID:

   ```bash
   mkdir -p ~/.config/cloudflared
   cp infra/cloudflared/config.yml ~/.config/cloudflared/config.yml
   # Edit ~/.config/cloudflared/config.yml and replace both <TUNNEL_UUID> occurrences
   # with the UUID printed by `tunnel create`.
   ```

9. **Start the pm2 stack:**

   ```bash
   pm2 start infra/pm2/ecosystem.config.cjs
   pm2 save
   pm2 startup   # follow the printed sudo command to enable auto-start at boot
   ```

   `pm2 status` should show all three processes (`flipturn-api`,
   `flipturn-workers`, `flipturn-tunnel`) Online.

### Verify Cloudflare Tunnel

After `pm2 start`, the tunnel process should connect within ~10 seconds. From
a laptop or phone **not** on the home network:

```bash
curl -i https://api.flipturn.app/v1/health
```

Expected: HTTP 200, body `{"db":"ok","redis":"ok"}`. Cloudflare will also
show the tunnel as "Healthy" in the Zero Trust dashboard.

## Routine ops

```bash
pm2 status                                 # all three processes Online
pm2 logs flipturn-api --lines 100          # last 100 API log lines
pm2 logs flipturn-workers --lines 100
pm2 logs flipturn-tunnel --lines 100
pm2 reload flipturn-api                    # zero-downtime reload after a deploy
pm2 reload flipturn-workers
pm2 monit                                  # live CPU/memory dashboard
```

## Updating

```bash
cd ~/flipturn
git pull
pnpm install
pnpm db:migrate
pm2 reload flipturn-api flipturn-workers
```

The tunnel does not need a reload unless `cloudflared` itself was upgraded or
the tunnel config changed.

## Tearing down

```bash
pm2 stop flipturn-api flipturn-workers flipturn-tunnel
pm2 delete flipturn-api flipturn-workers flipturn-tunnel
pm2 save                                   # persist the empty process list
pnpm dev:down                              # stop Postgres + Redis
```

To remove the Cloudflare Tunnel itself:

```bash
cloudflared tunnel delete flipturn-prod
# Then remove the api.flipturn.app CNAME in the Cloudflare DNS panel.
```

## Resend setup

The API sends magic-link emails through Resend. The free tier is sufficient
for closed beta (up to 3,000 emails/month, 100/day).

### One-time: register the sending domain

1. Sign in to https://resend.com (free signup).
2. Add `flipturn.app` as a sending domain.
3. Resend prints SPF, DKIM, and DMARC DNS records. Add them on the Cloudflare
   DNS panel (or wherever `flipturn.app` is hosted):
   - **SPF** — TXT record on `flipturn.app`:
     `v=spf1 include:_spf.resend.com ~all`
   - **DKIM** — Three CNAME records on subdomains like
     `resend._domainkey.flipturn.app` (Resend prints exact names + values).
   - **DMARC** — TXT on `_dmarc.flipturn.app`:
     `v=DMARC1; p=quarantine; rua=mailto:<your-monitoring-mailbox>`
4. Click **Verify** in the Resend dashboard. Verification takes 5–60 minutes
   depending on DNS propagation.
5. Generate a Resend API key (production scope) and put it in
   `~/.config/flipturn/secrets.env` as `RESEND_API_KEY=re_...`.

### Smoke test

After `pm2 start`, request a magic link:

```bash
curl -X POST https://api.flipturn.app/v1/auth/magic-link/request \
  -H 'content-type: application/json' \
  -d '{"email":"<your-actual-inbox>@gmail.com"}'
```

The email should arrive in 5–30 seconds. Check that:

- It comes from `noreply@flipturn.app` (matches `EMAIL_FROM`)
- It's not in the spam folder
- The deep link opens the app on the phone (Universal Links — see Plan 6 Task 12)

## Cloudflare 403 fallback

`results.swimming.ca` sits behind Cloudflare's WAF. Plan 5's smoke surfaced a
403 from a non-residential egress; the Mac Mini's residential IP is verified
in Plan 6 Task 13. If `www.swimming.ca` returns 403 to the Mac Mini, the
options in priority order are:

1. **Wait it out.** Cloudflare's WAF rules can be temporary. Try again in 24h.
2. **Slow the rate further.** Set `SCRAPE_RATE_LIMIT_MS=15000` and
   `SCRAPE_DAILY_HOST_BUDGET=200`. A smaller, slower footprint may avoid the
   WAF heuristics.
3. **Use a residential proxy.** Services like BrightData / IPRoyal offer
   rotating residential IPs. Adds ~$50/month; only worth it if the closed
   beta proves the wedge.
4. **Manual import.** At MVP scale (10–20 parents), the founder can manually
   fetch each athlete's page from a personal browser, save the HTML, and run
   `pnpm db:seed-fixture` (extended to take a path argument). Tedious but
   unblocks the beta.
5. **Reach out to SNC.** The spec's strategic plan eventually moves to a
   licensed data partnership. A 403 from public scraping accelerates that
   conversation.

A confirmed 403 from the residential IP is a Plan 6 DONE_WITH_CONCERNS — flag
it in the Plan 6 final report so the user can pick a fallback.

## Troubleshooting

- **`pm2 status` shows a process flapping (errored / restart count climbing):**
  `pm2 logs <name> --err --lines 200` to see the recent crashes. The most
  common causes are a missing/typo'd key in `secrets.env` or Postgres/Redis
  not running (`docker ps` should list both).
- **`cloudflared` connects but `api.flipturn.app` returns 502:** the tunnel
  is up but `localhost:3000` is not. Check `pm2 status flipturn-api` and
  `pm2 logs flipturn-api`.
- **DNS for `api.flipturn.app` doesn't resolve:** confirm the CNAME exists in
  the Cloudflare DNS panel and is **proxied** (orange cloud). Cloudflare
  Tunnel only works through proxied records.
- **Magic-link emails go to spam:** verify SPF / DKIM / DMARC are all green
  in the Resend dashboard. DMARC `p=quarantine` is intentional during beta;
  tighten to `p=reject` once delivery is stable.
