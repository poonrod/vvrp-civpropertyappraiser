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

## Environment

Configure production variables (database, `SESSION_SECRET`, Discord OAuth callback URL, etc.) in Evennode’s app settings or their documented env mechanism — mirror `.env.example` as needed.
