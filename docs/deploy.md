# Deploying

The server speaks plain HTTP on `127.0.0.1:4317` (Docker: published on `127.0.0.1:4317`). Put something in front
that handles HTTPS, then set `MAX_ORIGIN` to the public address.

## Caddy (automatic HTTPS)

```caddyfile
max.example.com {
	reverse_proxy 127.0.0.1:4317
}
```

`.env`:

```bash
MAX_ORIGIN=https://max.example.com
```

## nginx

```nginx
server {
    listen 443 ssl;
    server_name max.example.com;
    # ssl_certificate ... ; ssl_certificate_key ... ;
    client_max_body_size 12m;          # photo uploads are up to 10 MB
    location / {
        proxy_pass http://127.0.0.1:4317;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;           # the coach streams its replies
    }
}
```

## Under a sub-path

To serve it at `https://example.com/max/`, set `MAX_BASE_PATH=/max` and `MAX_ORIGIN=https://example.com`, and proxy
`/max` to the server. Cookies are scoped to the sub-path.

## Tailscale

`tailscale serve` (your tailnet only) or `tailscale funnel` (the internet) can provide HTTPS without a domain:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4317
```

`MAX_ORIGIN` is then your machine's `https://<name>.<tailnet>.ts.net` address.

To let only certain people reach the app at all, set `MAX_ALLOWED_LOGIN=you@example.com,partner@example.com`.
Tailscale Serve adds a `Tailscale-User-Login` header to tailnet requests and the server checks it. This is only safe
when Tailscale Serve is the only way to reach the server (keep it on `127.0.0.1`), since anyone who can reach the
port directly could send that header themselves. With the gate on, the login screen also shows "Who's here?".

## Without Docker (systemd)

Build once with `npm ci && npm run build`, copy `selfhost-dist/` to the server, and run it with Node 24:

```ini
# /etc/systemd/system/maximum-overdrive.service
[Unit]
Description=Maximum Overdrive
After=network-online.target

[Service]
User=max
WorkingDirectory=/opt/maximum-overdrive
EnvironmentFile=/opt/maximum-overdrive/.env
Environment=MAX_DATA_DIR=/var/lib/maximum-overdrive
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/maximum-overdrive

[Install]
WantedBy=multi-user.target
```

`selfhost-dist/` is self-contained (the server is one bundled file); it needs no `node_modules`.

## Email

Sign-up codes and password resets need an SMTP server (`MAX_SMTP_URL`). Any provider works; for a personal server
a Gmail account with an [app password](https://support.google.com/accounts/answer/185833) is the quickest. Without
email, set `MAX_SIGNUP=invite` or `closed` and create accounts with invite codes or `set-password`.

## Backups

Back up the data folder (`max.sqlite` and `files/`). For a consistent copy while running:

```bash
sqlite3 /var/lib/maximum-overdrive/max.sqlite ".backup '/backups/max-$(date +%F).sqlite'"
rsync -a /var/lib/maximum-overdrive/files/ /backups/files/
```

## Updating

Pull, rebuild and restart (`docker compose up -d --build`, or copy a new `selfhost-dist/` and restart the service).
The database is upgraded in place on start; back it up first. Never replace the data folder with a copy from
another machine.
