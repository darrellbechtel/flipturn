/**
 * pm2 ecosystem config for the Mac Mini production deploy.
 *
 * Run from the repo root:
 *   pm2 start infra/pm2/ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup    # follow the printed instruction to enable auto-start at boot
 *
 * Logs land in ~/.pm2/logs/. Aggregate them with:
 *   pm2 logs flipturn-api flipturn-workers flipturn-tunnel
 *
 * Notes for other deployers:
 *  - Paths below use `process.env.HOME` so they portably resolve to the
 *    deploying user's home directory. The original author's home is
 *    `/Users/darrell`; adapt examples in `infra/README.md` to match yours.
 *  - The `cloudflared` binary is found via PATH (Homebrew installs to
 *    `/opt/homebrew/bin/cloudflared` on Apple Silicon and
 *    `/usr/local/bin/cloudflared` on Intel). If pm2 cannot find it,
 *    set `script` to the absolute path printed by `which cloudflared`.
 */

const path = require('path');

// Resolve to the repo root from `infra/pm2/`.
const repoRoot = path.resolve(__dirname, '../..');

// `env_file` paths assume the deploying user has a populated
// `~/.config/flipturn/secrets.env` file (see `infra/README.md`).
// Using `process.env.HOME` keeps this portable across operators.
const secretsEnvFile = `${process.env.HOME}/.config/flipturn/secrets.env`;

// Path to the cloudflared tunnel config (this repo ships a template at
// `infra/cloudflared/config.yml`; the operator copies it under
// `~/.config/cloudflared/config.yml` after substituting the tunnel UUID).
const cloudflaredConfig = `${process.env.HOME}/.config/cloudflared/config.yml`;

module.exports = {
  apps: [
    {
      name: 'flipturn-api',
      cwd: repoRoot,
      script: 'pnpm',
      args: 'api:start',
      env: {
        NODE_ENV: 'production',
        // Real values come from the secrets file loaded via `env_file`.
      },
      env_file: secretsEnvFile,
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
    {
      name: 'flipturn-workers',
      cwd: repoRoot,
      script: 'pnpm',
      args: 'workers:start',
      env: {
        NODE_ENV: 'production',
      },
      env_file: secretsEnvFile,
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
    {
      name: 'flipturn-tunnel',
      cwd: repoRoot,
      script: 'cloudflared',
      args: `tunnel --config ${cloudflaredConfig} run`,
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
