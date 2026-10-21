# What you need to do by hand

**No computer (Render free):** follow [README → Easiest setup](README.md#easiest-setup-no-computer-needed-render-free): Render Blueprint → copy the backend key → here.now variable → GitHub secret and variable → run the deploy → open the address.

**Home computer** (list below):

Everything else is automated. Details for each step are in the [README](README.md#one-time-setup).

- [ ] **Secrets**: run `openssl rand -hex 32` twice, once for `DUBDECK_BACKEND_KEY` and once for `DUBDECK_SIGNING_SECRET`.
- [ ] **here.now**: create an API key and add it to GitHub as the secret `HERENOW_API_KEY`.
- [ ] **here.now variable**: create `DUBDECK_BACKEND_KEY` (dashboard → Variables, or the curl in the README) with `allowedUpstreams` = your tunnel hostname.
- [ ] **GitHub variable**: `DUBDECK_API_HOST` = your tunnel hostname (for example `dubdeck-api.example.com`).
- [ ] **Passcode**: choose one of 10+ characters and put it in `server/.env` as `DUBDECK_OWNER_PASSCODE`, with your email as `DUBDECK_OWNER_EMAIL`.
- [ ] **Cloudflare Tunnel**: create the tunnel, copy its token, and add a public hostname → `http://dubdeck:8000`. *(Needs a domain on Cloudflare. No domain? Use free Tailscale Funnel instead: README step 5b.)*
- [ ] **PC**: fill in `server/.env` (copy `server/.env.example`), put `CLOUDFLARE_TUNNEL_TOKEN=…` in `.env`, then run `docker compose up -d --build`.
- [ ] **Check**: `https://<tunnel-host>/healthz` returns `{"ok":true}`.
- [ ] **Deploy**: push to `main` or run the *Deploy web to here.now* workflow, then save the printed slug as the GitHub variable `HERENOW_SLUG`.
- [ ] **Try it**: open the Site, pass the here.now gate, enter your passcode once, and download something you have the right to download.
- [ ] *(Optional)* **Cookies file** for age-restricted or members-only videos: set `DUBDECK_COOKIES_FILE`.
- [ ] *(Optional, costs money)* **Render / Fly.io** instead of your PC: see the README.
