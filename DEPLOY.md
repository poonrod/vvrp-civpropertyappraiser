# Deploy to Evennode

Production deploys use **[Evennode](https://www.evennode.com/)** via Git.

## Git remote

Repository:

```text
git@git.evennode.com:c910569f7832f1361f5ce7c97d2aa763.git
```

Add the remote once (name `evennode`):

```bash
git remote add evennode git@git.evennode.com:c910569f7832f1361f5ce7c97d2aa763.git
```

If it already exists, update it:

```bash
git remote set-url evennode git@git.evennode.com:c910569f7832f1361f5ce7c97d2aa763.git
```

## Deploy

Default branch is `main`. Push to deploy:

```bash
git push evennode main
```

Or use the npm shortcut:

```bash
npm run deploy:evennode
```

## SSH

1. Use an SSH key on the machine that runs `git push` (your laptop or CI).
2. In the Evennode dashboard, add the **public** key (`.pub` file contents) for Git access — not the private key.
3. Test:

```bash
ssh -T git@git.evennode.com
```

Example public key format (ed25519):

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI… comment-or-email
```

Keep private keys out of the repo and out of chat logs.

## Environment (Evennode dashboard)

Set these under your app’s **Environment variables** (names match `.env.example`). **Without them the app will crash or return 500.**

| Variable | Required | Notes |
|----------|----------|--------|
| `SESSION_SECRET` | **Yes** | Long random string. Generate locally: `openssl rand -hex 32`. Missing → `secret option required for sessions`. |
| `NODE_ENV` | Recommended | `production` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | **Yes** for DB | Use the MySQL credentials Evennode provides for your app. |
| `BASE_URL` | Recommended | Your public site URL, e.g. `https://propappraiser.us-3.evennode.com` |
| `DISCORD_*` | For login | Set `DISCORD_REDIRECT_URI` to your live callback URL (Discord Developer Portal must match). |

After changing variables, redeploy or restart the app if Evennode does not auto-restart.

### HTTPS vs HTTP and cookies

If users access the site over **plain HTTP** only, cookies with `Secure` may not be stored. Prefer HTTPS / Evennode’s TLS. If you must use HTTP temporarily, you may need `SESSION_COOKIE_SECURE=false` (only if your app supports it — check `server/app.js` cookie options).
