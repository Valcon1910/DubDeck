# What you need to do by hand

Everything else is automated. Details for each step are in the [README](README.md#one-time-setup).

- [ ] **Secrets**: run `openssl rand -hex 32` twice, once for `DUBDECK_BACKEND_KEY` and once for `DUBDECK_SIGNING_SECRET`.
- [ ] **here.now**: create an API key and add it to GitHub as the secret `HERENOW_API_KEY`.
- [ ] **here.now variable**: create `DUBDECK_BACKEND_KEY` (dashboard → Variables, or the curl in the README) with `allowedUpstreams` = your tunnel hostname.
- [ ] **GitHub variable**: `DUBDECK_API_HOST` = your tunnel hostname (for example `dubdeck-api.example.com`).
- [ ] **Email for codes**: on a personal Gmail, turn on 2-Step Verification and create an App password, then put both in `server/.env` (`DUBDECK_SMTP_USER`, `DUBDECK_SMTP_PASSWORD`).
- [ ] **Cloudflare Tunnel**: create the tunnel, copy its token, and add a public hostname → `http://dubdeck:8000`. *(Needs a domain on Cloudflare; buying one costs money.)*
- [ ] **PC**: fill in `server/.env` (copy `server/.env.example`), put `CLOUDFLARE_TUNNEL_TOKEN=…` in `.env`, then run `docker compose up -d --build`.
- [ ] **Check**: `https://<tunnel-host>/healthz` returns `{"ok":true}`.
- [ ] **Deploy**: push to `main` or run the *Deploy web to here.now* workflow, then save the printed slug as the GitHub variable `HERENOW_SLUG`.
- [ ] **Try it**: open the Site, pass the here.now gate, enter your email and the code you receive, and download something you have the right to download.
- [ ] *(Optional)* **Cookies file** for age-restricted or members-only videos: set `DUBDECK_COOKIES_FILE`.
- [ ] *(Optional, costs money)* **Render / Fly.io** instead of your PC: see the README.
