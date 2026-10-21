# DubDeck

A private, personal web app for downloading video and audio. Paste links, preview them, pick a preset, and DubDeck downloads, converts, tags and stores the files on your own machine.

> For personal use with content you have the right to download.

```
 Browser ──HTTPS──▶ here.now Site (restricted: Google or email magic link)
   │                 ├─ static app (web/dist)
   │                 └─ proxy routes (.herenow/proxy.json)
   │                        /api/*  and  /events  ──▶ adds X-DubDeck-Key ──┐
   │                                                                        ▼
   │                                              Cloudflare Tunnel ──▶ DubDeck backend (Docker on your PC)
   │                                                                        │ FastAPI + yt-dlp + ffmpeg
   └──── large files: 15-minute HMAC-signed URL, fetched directly ◀─────────┘
```

| Part | What | Where |
|---|---|---|
| `web/` | Vite + React + TypeScript front end | published to here.now as an account-owned Site |
| `server/` | FastAPI + yt-dlp + ffmpeg (+ Deno for YouTube) in Docker | your PC behind a Cloudflare Tunnel, or Render / Fly.io unchanged |
| `web/herenow/proxy.template.json` | here.now proxy routes; `${DUBDECK_BACKEND_KEY}` is filled in server-side by here.now | becomes `dist/.herenow/proxy.json` at build time |
| `config/allowed-emails.json` | the allowlist | synced to here.now by a GitHub Action; also read by the backend |

## Security model (three locks)

1. **here.now restricted access.** Visitors see here.now's invite-only gate and verify with **Google or an emailed magic link**. Only emails or domains in `config/allowed-emails.json` get in.
2. **Proxy key.** The here.now proxy adds `X-DubDeck-Key` from an account variable pinned with `allowedUpstreams` to your tunnel hostname. The backend rejects every `/api` request without it. The key never reaches the browser.
3. **In-app passcode.** here.now does not pass the visitor's identity to proxy upstreams, so the app has its own sign-in: each new device enters a private passcode once (wrong guesses are slowed down, and 10 failures lock sign-in for 15 minutes). The backend checks that the owner email is still on its own copy of the allowlist and issues a session that lasts 30 days from your last use (it renews itself each time you use the app). The allowlist is re-checked on **every** request, so removing an email locks that account out immediately. This also powers the "Signed in as …" chip.

Large files bypass the proxy. The backend returns a signed URL for **one file** that **expires in 15 minutes** (HMAC-SHA256), and the browser fetches it directly from the tunnel. Range requests work, so the inline player can seek.

Other protections: URL validation that blocks private and loopback addresses; yt-dlp always runs as an argument list (never a shell) with `--ignore-config` and `--` before the URL; filenames are rendered by DubDeck, not by yt-dlp templates; React escapes all metadata; a Content-Security-Policy is set; the backend has per-route rate limits; the container runs as a non-root user.

---

## Easiest setup: no computer needed (Render free)

The backend runs on Render's free plan, so you only ever use the website (for example on an iPad). Nothing runs on your computer.

**Trade-offs:** the server sleeps after about 15 minutes unused, so the first request takes about a minute to wake it. Its disk is wiped when it restarts, so finished downloads are **saved straight to your device** and the Library is temporary. Converting is slow (512 MB RAM). YouTube often blocks cloud servers ("confirm you're not a bot"); many other sites work.

1. **Render**: sign up at <https://render.com> with GitHub (the free plan needs no card; if asked for one, stop). Click **New → Blueprint**, pick your DubDeck repo, and confirm. When asked, enter:
   - `DUBDECK_OWNER_PASSCODE`: your passcode (10+ characters)
   - `DUBDECK_OWNER_EMAIL`: your email (it must be in `config/allowed-emails.json`)

   Wait for **Live**. Note the address, e.g. `https://dubdeck-api-ab12.onrender.com`, and open `…/healthz`: it should show `{"ok":true}`.
2. **Copy the backend key**: in Render, open **dubdeck-api → Environment** and copy the generated value of `DUBDECK_BACKEND_KEY`.
3. **here.now variable**: in the here.now dashboard → **Variables**, add `DUBDECK_BACKEND_KEY` = that value, with allowed upstreams `dubdeck-api-ab12.onrender.com`.
4. **GitHub** (**Settings → Secrets and variables → Actions**): add the secret `HERENOW_API_KEY` (your here.now API key) and the variable `DUBDECK_API_HOST` = `dubdeck-api-ab12.onrender.com`.
5. **Publish**: **Actions → Deploy web to here.now → Run workflow**. The log ends with `Live: https://<slug>.here.now/` (your DubDeck address) and asks you to save the slug as the variable `HERENOW_SLUG`. Do that.
6. **Use it**: open the address, pass here.now's gate, enter your passcode once, and add it to your home screen.

Editing `config/allowed-emails.json` on GitHub updates both here.now (via the sync workflow) and Render (it redeploys on every push to `main`).

The steps below are the **home-computer setup** (more reliable for YouTube, keeps a Library).

## One-time setup

You need: a here.now account (free plan is enough), an email account that can send mail over SMTP (for example a personal Gmail with an app password), a domain on Cloudflare for the tunnel hostname (the Cloudflare plan is free; a domain costs money if you don't have one), and Docker on your PC.

### 1. Generate two secrets

```bash
openssl rand -hex 32   # → DUBDECK_BACKEND_KEY
openssl rand -hex 32   # → DUBDECK_SIGNING_SECRET (must be different)
```

### 2. here.now API key

Sign in at <https://here.now/dashboard> and create an API key (Settings → API keys), or use the agent flow (`POST /api/auth/agent/request-code` → `verify-code`). Keep it out of the repo: never commit `~/.herenow/credentials` or `.herenow/state.json` (both are in `.gitignore`).

In GitHub, open **Settings → Secrets and variables → Actions**:
- **Secret** `HERENOW_API_KEY` = your `hnk_…` key
- **Variable** `DUBDECK_API_HOST` = your tunnel hostname, e.g. `dubdeck-api.example.com` (hostname only, no `https://`)
- **Variable** `HERENOW_SLUG`: leave unset until step 7

### 3. here.now account variable (the proxy key)

Store the backend key on your here.now account, pinned to your tunnel hostname:

```bash
curl -sS -X PUT https://here.now/api/v1/me/variables/DUBDECK_BACKEND_KEY \
  -H "Authorization: Bearer $HERENOW_API_KEY" \
  -H "X-HereNow-Client: manual/dubdeck-setup" \
  -H "Content-Type: application/json" \
  -d '{"value":"<DUBDECK_BACKEND_KEY>","allowedUpstreams":["dubdeck-api.example.com"]}'
```

(You can also do this in the dashboard's **Variables** tab.)

### 4. Choose your passcode

Pick a private passcode of at least 10 characters (a few random words works well). In `server/.env` (step 6) set:

- `DUBDECK_OWNER_PASSCODE` to that passcode;
- `DUBDECK_OWNER_EMAIL` to your email. It must be in `config/allowed-emails.json`, and removing it from there signs every device out.

Each new device asks for the passcode once, after here.now's gate, then stays signed in. To change the passcode, edit `.env` and run `docker compose up -d`. Existing devices stay signed in; to sign them out, use **Settings → Sign out everywhere**.

*Optional alternatives* (both can be enabled together with the passcode): emailed 6-digit codes via SMTP (`DUBDECK_SMTP_*`, see `server/.env.example`), or "Sign in with Google" (`DUBDECK_GOOGLE_CLIENT_ID`, which needs Google Cloud Console).

### 5. Cloudflare Tunnel

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**. Name it `dubdeck`.
2. Choose **Docker** and copy the token from the shown command (the long string after `--token`).
3. **Public hostname**: `dubdeck-api.example.com` → Service **HTTP** `dubdeck:8000`.
4. Do **not** use a "quick tunnel" (`trycloudflare.com`); its URL changes on every restart.

### 5b. No domain? Use Tailscale Funnel instead (free)

Skip step 5 and use this instead. It gives your PC a permanent public address like `https://dubdeck.tail1234.ts.net` with no domain needed.

1. Create a free account at <https://login.tailscale.com/start> (sign in with Google, Microsoft or GitHub).
2. In the admin console, open **DNS** and make sure **MagicDNS** and **HTTPS Certificates** are on. Note your tailnet name, e.g. `tail1234.ts.net`.
3. Open **Access controls** and allow Funnel by adding this to the policy file, then save:
   ```json
   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }],
   ```
   (Tailscale also offers to add it for you the first time Funnel is used.)
4. Open **Settings → Keys → Generate auth key**, then copy it.
5. In the repo folder, create `.env` containing `TS_AUTHKEY=<that key>`.
6. Your backend address is `dubdeck.<tailnet name>`, e.g. `dubdeck.tail1234.ts.net`. Use it for `DUBDECK_PUBLIC_URL` (`https://…`), the GitHub variable `DUBDECK_API_HOST`, and the here.now variable's `allowedUpstreams`.
7. In step 6, start with `docker compose -f docker-compose.tailscale.yml up -d --build` instead of `docker compose up -d --build`.

### 6. Run the backend

```bash
cp server/.env.example server/.env        # fill in the values from steps 1, 4, 5 (and DUBDECK_PUBLIC_URL)
echo "CLOUDFLARE_TUNNEL_TOKEN=<token from step 5>" > .env
docker compose up -d --build
docker compose logs -f dubdeck            # "Application startup complete"
curl https://dubdeck-api.example.com/healthz   # → {"ok":true}
```

Without Compose, the equivalent `docker run` commands (PowerShell: replace `$PWD` with `${PWD}`):

```bash
docker build -f server/Dockerfile -t dubdeck-server .
docker network create dubdeck
docker run -d --name dubdeck --network dubdeck --restart unless-stopped \
  --env-file server/.env -v dubdeck-data:/data -v "$PWD/config:/app/config:ro" dubdeck-server
docker run -d --name cloudflared --network dubdeck --restart unless-stopped \
  cloudflare/cloudflared:2026.9.3 tunnel --no-autoupdate run --token <TUNNEL_TOKEN>
```

The backend port is not published on your PC; only `cloudflared` can reach it.

### 7. First deploy

Push to `main` (or run **Actions → Deploy web to here.now → Run workflow**). The workflow:

1. builds `web/` with `DUBDECK_API_HOST`, which writes `dist/.herenow/proxy.json`;
2. publishes with **create → upload → finalize** (sending `X-HereNow-Client`), and **fails if finalize warns about `proxy.json` or `data.json`**;
3. sets the Site to **restricted** with the allowlist.

On the first run there is no slug yet, so the job creates the Site and prints `Save "<slug>" as the HERENOW_SLUG repository variable`. Add that variable and you're done. Open the URL, pass the here.now gate, then enter your passcode in the app. That device then stays signed in.

### 8. Add someone (or another address) to the allowlist

Edit `config/allowed-emails.json` on GitHub and commit to `main`:

```json
{ "emails": ["valentino.104688@anglo.edu.co", "another@example.com"], "domains": [] }
```

- **here.now**: the *Sync access allowlist* workflow reads the current policy, prints the diff, and writes the file's full contents (`PATCH /api/v1/publish/:slug/access` replaces the whole list; `notify: false`, so no invite emails are sent).
- **Backend**: run `git pull` on your PC; the mounted file is re-read within seconds, with no restart. To have the backend fetch the file from GitHub automatically instead (useful on Render or Fly), set `DUBDECK_ALLOWLIST_URL` (and `DUBDECK_ALLOWLIST_TOKEN` for a private repo; see `server/.env.example`).

---

## Day-to-day

- **Update yt-dlp** (sites change often): `docker compose exec dubdeck dubdeck-update-ytdlp`, or **Settings → Server → Update yt-dlp** in the app. The new version lands on the `/data` volume and is used by the next download, with no rebuild or restart.
- **Cookies** (for age-restricted or members-only videos, or when a site demands "confirm you're not a bot"): export a `cookies.txt` from a browser where you're signed in, copy it into the volume (for example `docker cp cookies.txt dubdeck:/data/cookies.txt`), and set `DUBDECK_COOKIES_FILE=/data/cookies.txt`.
- **Backups**: everything lives in the `dubdeck-data` volume (`/data`: `dubdeck.db`, `media/`, `thumbs/`).

## Features

- **Download**: paste one or many links (or press <kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere on the page); a preview card shows thumbnail, title, channel, duration, available qualities and a formats table. Playlists open as a checklist.
- **Video**: Best, 2160p, 1440p, 1080p, 720p, 480p, 360p · MP4 (H.264/AAC, the default: re-encodes when the site only has VP9/AV1; switch to "Fast" in Settings to keep the original codec) or WebM (VP9/Opus).
- **Audio**: MP3 320/256/192/128, M4A/AAC, Opus, WAV, with cover art and title/artist/album tags (editable per download).
- **Extras**: trim start/end, embedded subtitles (pick a language; optional auto-captions), filename templates (`{title} - {channel}`, plus `{artist} {album} {date} {quality} {format} {id} {site}`), and custom presets you can save, rename, reorder and delete.
- **Queue**: simultaneous-download limit, live waveform progress with speed and ETA over SSE, pause (resumes from the partial file), cancel, retry, and history with save and re-download.
- **Friendly errors**: unsupported site, private, age-restricted, region-blocked, bot check, removed, rate-limited, and more.
- **Library**: storage used vs. your quota, video/audio breakdown, largest files, grid/list view, search/sort/filter, inline player, save to device, rename, delete, bulk delete, and auto-cleanup (older than N days and/or oldest-first when over quota).
- **Settings** (stored on the backend, synced across devices; `localStorage` is only a cache): theme Light/Dark/System, accent color with presets (contrast auto-adjusted to stay AA), density, font size, reduced motion, download defaults, presets, storage rules.
- **Keyboard**: <kbd>Ctrl</kbd>+<kbd>V</kbd> paste and preview, <kbd>Alt</kbd>+<kbd>1–4</kbd> navigate, <kbd>/</kbd> search the library, <kbd>?</kbd> list shortcuts, <kbd>Esc</kbd> close.

## here.now limits that matter

| Limit | Value | How DubDeck handles it |
|---|---|---|
| Proxy rate limit | 100 req/hour/IP by default | raised per route: `/api/*` 1000/hour/ip, `/events` 600/hour/ip |
| Proxy request body | 10 MB | API bodies are small JSON (the backend caps them at 1 MB) |
| Large responses | — | files never go through the proxy; signed URLs go straight to the tunnel |
| Job progress | — | one SSE stream (`/events`), no polling; reconnects with backoff |
| Invalid `proxy.json` | publish succeeds, routes silently 404 | the deploy job fails on finalize warnings |
| Proxy routes per version | dropped if a publish omits the file | every build writes `.herenow/proxy.json` |

Site Data (`.herenow/data.json`) is not used: settings and history must be private and synced, and the backend is already the source of truth.

## Deploy the backend to Render or Fly.io (optional, costs money)

The same image runs unchanged. Set the same environment variables, and set `DUBDECK_PUBLIC_URL` to the service URL. Then change the GitHub variable `DUBDECK_API_HOST` and the here.now variable's `allowedUpstreams` to the new hostname.

- **Render**: `render.yaml` (Blueprint). A persistent disk needs a paid instance.
- **Fly.io**: `fly.toml`; `fly volumes create dubdeck_data --size 20`, `fly secrets set …`, `fly deploy`.

Use `DUBDECK_ALLOWLIST_URL` there, since there is no local checkout to `git pull`.

## Development

```bash
# backend
cd server && python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
DUBDECK_BACKEND_KEY=$(openssl rand -hex 32) DUBDECK_SIGNING_SECRET=$(openssl rand -hex 32) \
DUBDECK_DATA_DIR=./data DUBDECK_ALLOWLIST_PATH=../config/allowed-emails.json DUBDECK_DEV_LOGIN=1 \
DUBDECK_PUBLIC_URL=http://127.0.0.1:8000 uvicorn --factory app.main:create_app --port 8000

# front end (Vite plays the role of the here.now proxy and injects the key)
cd web && npm ci
DUBDECK_BACKEND_KEY=<same key> npm run dev     # http://127.0.0.1:5173
```

`DUBDECK_DEV_LOGIN=1` adds a "Developer sign-in" form that skips Google for allowlisted emails. **Never enable it in production.**

### Running the end-to-end tests

With the backend (dev login on, `DUBDECK_ALLOW_PRIVATE_URLS=1`) and `npm run dev` running, plus a small test video served locally:

```bash
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine -t 20 -c:v libx264 -c:a aac -pix_fmt yuv420p test720.mp4
python3 -m http.server 8765 &               # in the folder with test720.mp4
python3 web/e2e/slowserve.py . &           # throttled copy on :8766 for the pause/resume test
cd web && DUBDECK_E2E_EMAIL=you@example.com npx playwright test
```

The suite covers sign-in (including refusal of unlisted emails, and that the key never reaches the browser), Ctrl+V paste and preview, audio download with tags, the inline player via signed URL, rename and delete, video download with pause/resume and save to device, friendly errors, settings synced to the server across a cache wipe, preset reorder and rename, sign-out, and the 360 px phone layout with no horizontal scroll.

## Things to know

- **Signing out** of DubDeck ends the app session (or all sessions). here.now has no documented sign-out for its gate, so its grant stays until it expires or the allowlist changes.
- If here.now's proxy ever strips the custom `X-DubDeck-Session` header, the app automatically switches to the `dd_session` query parameter (here.now forwards query parameters).
- YouTube often blocks data-center IPs with a bot check. That's one reason to run the backend on your home connection. If it happens there too, add a cookies file.
