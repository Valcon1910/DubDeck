# DubDeck backend: FastAPI + yt-dlp + ffmpeg (+ Deno, which yt-dlp needs for YouTube).
# The same image runs on a home PC (behind Cloudflare Tunnel), Render, and Fly.io.

FROM denoland/deno:bin-2.9.8 AS deno

FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DUBDECK_DATA_DIR=/data \
    DUBDECK_ALLOWLIST_PATH=/app/config/allowed-emails.json \
    PORT=8000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

WORKDIR /app
COPY server/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY server/app ./app
COPY server/bin/dubdeck-update-ytdlp /usr/local/bin/dubdeck-update-ytdlp
# Baked-in copy of the allowlist; mount ./config over it to edit without rebuilding.
COPY config/allowed-emails.json ./config/allowed-emails.json

RUN useradd --create-home --uid 10001 dubdeck \
 && mkdir -p /data && chown dubdeck:dubdeck /data \
 && chmod 0755 /usr/local/bin/dubdeck-update-ytdlp
USER dubdeck
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/healthz', timeout=4)"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec uvicorn --factory app.main:create_app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 15"]
