# Flip Turn — production deployment runbook

This directory holds production-deploy configs for the Mac Mini host. Plan 6
introduced these; nothing here is referenced from the application code at
runtime — they're operational scaffolding.

The MVP target host is a Mac Mini on a residential network. Cloudflare Tunnel
exposes the API to mobile clients without opening home-network ports; pm2
supervises the API + workers + tunnel processes; Resend delivers magic-link
emails from a verified `flipturn.ca` sending domain.

## Files

- `pm2/ecosystem.config.cjs` — pm2 process definitions for `flipturn-api`,
  `flipturn-workers`, and `flipturn-tunnel` (cloudflared)
- `cloudflared/config.yml` — Cloudflare Tunnel routing for `api.flipturn.ca`
  (UUID `1431a0f0-…` baked in; tunnel was created on the Mac Mini under
  the `hank` user — see file header for redeploy steps)

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

# Resend — get from resend.com after verifying flipturn.ca (see "Resend setup" below)
RESEND_API_KEY="re_..."
EMAIL_FROM="Flip Turn <noreply@flipturn.ca>"

# API tuning
PORT=3000
BASE_URL="https://api.flipturn.ca"
MOBILE_DEEP_LINK_BASE="https://flipturn.ca/auth"  # Universal Links once enabled (Plan 6 Task 12)
LOG_LEVEL="info"

# Worker politeness
SCRAPE_USER_AGENT="FlipTurnBot/0.1 (+https://flipturn.ca/bot; contact@flipturn.ca)"
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

   Make sure the Docker daemon auto-starts at login so the stack survives
   reboots without manual intervention. With OrbStack:

   ```bash
   orb config set app.start_at_login true
   ```

   The compose services use `restart: unless-stopped`, so once the daemon
   is up, Postgres + Redis come back without needing `pnpm dev:up`.

6. **Run migrations and (optionally) seed the Cochrane fixture for smoke testing:**

   ```bash
   pnpm db:migrate
   pnpm db:seed-fixture   # optional
   ```

7. **Create the secrets file** per the "Secrets file" section above.

8. **Set up the Cloudflare Tunnel:**

   The tunnel `flipturn-prod` (UUID `1431a0f0-ad42-43a7-a435-c5fa44a28a71`)
   has already been created on the Mac Mini. The UUID and credentials path
   are baked into `infra/cloudflared/config.yml`. To deploy:

   ```bash
   # one-time login (skip if ~/.cloudflared/cert.pem already exists)
   cloudflared tunnel login

   # route DNS (creates a CNAME api.flipturn.ca -> <UUID>.cfargotunnel.com)
   cloudflared tunnel route dns flipturn-prod api.flipturn.ca

   # drop the config in place
   mkdir -p ~/.config/cloudflared
   cp infra/cloudflared/config.yml ~/.config/cloudflared/config.yml
   ```

   If the tunnel ever has to be re-created (e.g. credentials lost), update
   `infra/cloudflared/config.yml` with the new UUID and credentials path
   and land that as a separate PR.

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
curl -i https://api.flipturn.ca/v1/health
```

Expected: HTTP 200, body `{"db":"ok","redis":"ok"}`. Cloudflare will also
show the tunnel as "Healthy" in the Zero Trust dashboard.

## Unattended boot recovery (residential single-tenant only)

A residential power-outage cycle should bring `api.flipturn.ca` back without
anyone touching the Mac Mini. The chain that makes this work:

1. Power-on → disk decrypts automatically (FileVault **off**).
2. macOS auto-logs the deploying user in (no password prompt).
3. User-level `launchd` runs `pm2 resurrect`, which starts api / workers / tunnel.
4. OrbStack auto-starts at login (`app.start_at_login = true`).
5. Postgres + Redis come back via `restart: unless-stopped` in `compose.dev.yaml`.

End-to-end recovery is ~60s from power-on to public health 200, no human required.

### Security trade-off

This setup deliberately turns off two macOS protections:

- **FileVault is disabled.** The disk is unencrypted at rest. Anyone with
  physical access to a powered-off Mac Mini can read everything on it,
  including `~/.config/flipturn/secrets.env` (Resend key, JWT secret, DB
  password) and the swim-data Postgres volume.
- **Auto-login is enabled.** Anyone who powers the Mac Mini on gets a
  logged-in session of the deploying user without a password prompt.

This is acceptable for a single-tenant residential deploy where the threat
model is "uptime through power blips," not "physical theft." Do **not**
replicate this configuration on a multi-user host, an office, or anywhere the
machine's physical security can't be assumed.

### One-time setup

1. **Disable FileVault.** Run in Terminal:

   ```bash
   sudo fdesetup disable -user <deploying-user>
   ```

   Decryption runs in the background — `fdesetup status` shows progress. Wait
   for `FileVault is Off.` before continuing.

2. **Enable OrbStack at login** (if not done in "First deploy" step 5):

   ```bash
   orb config set app.start_at_login true
   ```

3. **Configure auto-login.** On macOS 26 the System Settings GUI sets
   `autoLoginUser` but does **not** reliably write `/etc/kcpassword`, so do
   both manually. In Terminal (replace `hank` with the deploying user):

   ```bash
   sudo defaults write /Library/Preferences/com.apple.loginwindow autoLoginUser hank
   read -rs -p "Account password: " PW; echo
   sudo python3 - "$PW" <<'PY'
   import sys, os
   key = bytes([0x7D,0x89,0x52,0x23,0xD2,0xBC,0xDD,0xEA,0xA3,0xB9,0x1F])
   pw  = sys.argv[1].encode("utf-8")
   pad = (-len(pw)) % 12 or 12
   buf = bytearray(pw + b"\x00" * pad)
   for i in range(len(buf)):
       buf[i] ^= key[i % len(key)]
   open("/etc/kcpassword", "wb").write(bytes(buf))
   os.chmod("/etc/kcpassword", 0o600)
   PY
   unset PW
   ```

   `/etc/kcpassword` should be `-rw------- root:wheel` and a multiple of 12
   bytes. The cipher is Apple's documented kcpassword XOR scheme.

4. **Verify.** Reboot the Mac Mini. It should come back up with no password
   prompt, and `curl -sS https://api.flipturn.ca/v1/health` should return
   `{"db":"ok","redis":"ok"}` within ~60s of power-on.

### Reverting

If the Mac Mini ever needs to be relocated or sold:

```bash
sudo rm /etc/kcpassword
sudo defaults delete /Library/Preferences/com.apple.loginwindow autoLoginUser
sudo fdesetup enable          # interactive — prints a recovery key, save it
```

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
# Then remove the api.flipturn.ca CNAME in the Cloudflare DNS panel.
```

## Resend setup

The API sends magic-link emails through Resend. The free tier is sufficient
for closed beta (up to 3,000 emails/month, 100/day).

### One-time: register the sending domain

1. Sign in to https://resend.com (free signup).
2. Add `flipturn.ca` as a sending domain.
3. Resend prints SPF, DKIM, and DMARC DNS records. Add them on the Cloudflare
   DNS panel (or wherever `flipturn.ca` is hosted):
   - **SPF** — TXT record on `flipturn.ca`:
     `v=spf1 include:_spf.resend.com ~all`
   - **DKIM** — Three CNAME records on subdomains like
     `resend._domainkey.flipturn.ca` (Resend prints exact names + values).
   - **DMARC** — TXT on `_dmarc.flipturn.ca`:
     `v=DMARC1; p=quarantine; rua=mailto:<your-monitoring-mailbox>`
4. Click **Verify** in the Resend dashboard. Verification takes 5–60 minutes
   depending on DNS propagation.
5. Generate a Resend API key (production scope) and put it in
   `~/.config/flipturn/secrets.env` as `RESEND_API_KEY=re_...`.

### Smoke test

After `pm2 start`, request a magic link:

```bash
curl -X POST https://api.flipturn.ca/v1/auth/magic-link/request \
  -H 'content-type: application/json' \
  -d '{"email":"<your-actual-inbox>@gmail.com"}'
```

The email should arrive in 5–30 seconds. Check that:

- It comes from `noreply@flipturn.ca` (matches `EMAIL_FROM`)
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
   fetch each athlete's page from a personal browser (residential, JS-enabled,
   no bot UA), save the HTML, and run:

   ```bash
   pnpm db:seed-fixture \
     --html /path/to/saved-athlete.html \
     --sncId 1234567 \
     --email parent@example.com
   ```

   The script links the saved athlete to the parent's user record and prints
   a one-shot sign-in deep link. Tedious but unblocks the beta with zero
   architecture changes — same parser/reconciler/PB pipeline.

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
- **`cloudflared` connects but `api.flipturn.ca` returns 502:** the tunnel
  is up but `localhost:3000` is not. Check `pm2 status flipturn-api` and
  `pm2 logs flipturn-api`.
- **DNS for `api.flipturn.ca` doesn't resolve:** confirm the CNAME exists in
  the Cloudflare DNS panel and is **proxied** (orange cloud). Cloudflare
  Tunnel only works through proxied records.
- **Magic-link emails go to spam:** verify SPF / DKIM / DMARC are all green
  in the Resend dashboard. DMARC `p=quarantine` is intentional during beta;
  tighten to `p=reject` once delivery is stable.
