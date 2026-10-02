# Running it for other people

Everything in [deploy.md](deploy.md) applies. On top of that, when people other than you and your partner use your
server, you're looking after their private journals and photos. This is the checklist.

## Settings

```bash
MAX_ORIGIN=https://max.example.com
MAX_TRUST_PROXY=1                  # behind Caddy/nginx: per-IP limits use the real client address
MAX_SIGNUP=invite                  # start invite-only; switch to open when you're ready
MAX_SMTP_URL=smtps://...           # sign-up codes and password resets need email
MAX_MAIL_FROM=Maximum Overdrive <no-reply@example.com>
MAX_USER_STORAGE_MB=1024           # photos and files per account (0 = no limit)
MAX_SIGNUPS_PER_HOUR=10            # per IP address
MAX_OPERATOR=Your name             # shown on /privacy and /terms
MAX_CONTACT_EMAIL=you@example.com
MAX_BACKUP_DAYS=30                 # how long backups keep deleted data (shown on /privacy)
MAX_MIN_AGE=16
```

Only set `MAX_TRUST_PROXY=1` when the server is reachable through your proxy alone (keep it on `127.0.0.1`).
Otherwise anyone could send a made-up `X-Forwarded-For` header to get around the per-IP limits.

## Privacy policy and terms

`/privacy` and `/terms` are generated from the server's settings: who runs it, which email and AI providers are used,
how long things are kept. Read both before you open sign-ups, and replace them with your own pages
(`MAX_PRIVACY_URL`, `MAX_TERMS_URL`) if anything doesn't fit your situation. They're a starting point, not legal
advice; if you're in the EU, the UK or the UAE, check what GDPR or the UAE PDPL asks of you.

## What people can do themselves

- Download everything (Profile → Export everything).
- Delete their account (Profile → Delete my account, with their password). Everything that's only theirs is
  removed right away, photos included; a shared journal moves into their partner's own journal.
- Change their email and reset a forgotten password.

## Admin commands

Run on the server (with Docker: `docker compose exec max node server.mjs <command>`):

| Command | What it does |
|---|---|
| `list-users` | Everyone with email, role, status, storage used and sign-up date |
| `disable-user <username>` | Blocks logging in and signs them out everywhere |
| `enable-user <username>` | Lets them log in again |
| `set-role <username> admin\|member` | Changes who the admin is |
| `delete-user <username> --yes` | Deletes the account the same way "Delete my account" does |
| `set-password <username>` | Sets a password (for someone who can't use email reset) |

## Backups and updates

- Back up nightly, off the server, and test a restore now and then (see [deploy.md](deploy.md#backups)).
  Encrypt backups that leave the machine, for example with [restic](https://restic.net).
- Update regularly: `git pull && docker compose up -d --build`. Read the commit log for anything about security.
- Watch `/health` with an uptime checker so you hear when it's down.

## Built-in protection

- Passwords hashed with scrypt; sessions in `HttpOnly`, `SameSite=Strict` cookies; every change must come from
  `MAX_ORIGIN`.
- Login lockout per account (5 wrong passwords, 5 minutes) and per IP address (30 failures in 15 minutes).
- Sign-up codes: hashed, 15 minutes, 5 tries; at most one email a minute per address and 10 an hour per IP.
- People only ever see their own data and their partner's shared things; the tests check this.
- A storage quota per account and a size limit per upload (10 MB).
