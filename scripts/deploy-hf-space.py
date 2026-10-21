#!/usr/bin/env python3
"""Deploy the DubDeck backend to a free Hugging Face Docker Space (no card needed).

Run by .github/workflows/deploy.yml when the HF_TOKEN secret exists. It:
  1. creates the Space <your-hf-username>/<HF_SPACE> (default "dubdeck") if missing;
  2. sets the Space's secrets and variables (backend key, signing secret, passcode, ...);
  3. uploads the server code with a Dockerfile adapted to Hugging Face (user 1000);
  4. stores the backend key in your here.now account variable, pinned to the Space host;
  5. writes the Space hostname to $GITHUB_OUTPUT as `host` for the web build.

Required env: HF_TOKEN (write token), DUBDECK_OWNER_PASSCODE, HERENOW_API_KEY.
Optional env: HF_SPACE, DUBDECK_OWNER_EMAIL, DUBDECK_BACKEND_KEY, DUBDECK_SIGNING_SECRET.
If the two keys aren't given, they're derived from HF_TOKEN, so they stay stable
between runs without you having to create them.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERENOW_API = os.environ.get("HERENOW_API", "https://here.now").rstrip("/")


def fail(msg: str) -> None:
    print(f"::error::{msg}")
    sys.exit(1)


def env(name: str, required: bool = True) -> str:
    value = os.environ.get(name, "").strip()
    if required and not value:
        fail(f"{name} is not set. Add it under GitHub → Settings → Secrets and variables → Actions.")
    return value


def derived(label: str, token: str) -> str:
    return hashlib.sha256(f"dubdeck:{label}:{token}".encode()).hexdigest()


def stage(dest: Path) -> None:
    """Copy what the Space needs and adapt the Dockerfile to Hugging Face's rules."""
    shutil.copytree(ROOT / "server" / "app", dest / "server" / "app",
                    ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "server" / "bin", dest / "server" / "bin")
    shutil.copy(ROOT / "server" / "requirements.txt", dest / "server" / "requirements.txt")
    (dest / "config").mkdir()
    shutil.copy(ROOT / "config" / "allowed-emails.json", dest / "config" / "allowed-emails.json")

    dockerfile = (ROOT / "server" / "Dockerfile").read_text()
    # Spaces run the container as user ID 1000 and keep data under the home directory.
    dockerfile = dockerfile.replace("--uid 10001", "--uid 1000")
    dockerfile = dockerfile.replace("DUBDECK_DATA_DIR=/data", "DUBDECK_DATA_DIR=/home/dubdeck/data")
    dockerfile = dockerfile.replace("mkdir -p /data && chown dubdeck:dubdeck /data",
                                    "mkdir -p /home/dubdeck/data && chown dubdeck:dubdeck /home/dubdeck/data")
    dockerfile = dockerfile.replace('VOLUME ["/data"]\n', "")
    for needle in ("--uid 1000", "/home/dubdeck/data"):
        if needle not in dockerfile:
            fail(f"server/Dockerfile changed shape; could not adapt it for Hugging Face ({needle}).")
    (dest / "Dockerfile").write_text(dockerfile)

    (dest / "README.md").write_text(
        "---\n"
        "title: DubDeck API\n"
        "emoji: 📼\n"
        "colorFrom: red\n"
        "colorTo: gray\n"
        "sdk: docker\n"
        "app_port: 8000\n"
        "pinned: false\n"
        "short_description: Private backend for a personal DubDeck site\n"
        "---\n\n"
        "Backend for a private DubDeck site. Every API request needs a key that only\n"
        "the owner's here.now proxy has; there is nothing to use here directly.\n"
        "Deployed automatically from GitHub; edits made here are overwritten.\n"
    )


def herenow_variable(key: str, host: str) -> None:
    req = urllib.request.Request(
        f"{HERENOW_API}/api/v1/me/variables/DUBDECK_BACKEND_KEY",
        method="PUT",
        data=json.dumps({"value": key, "allowedUpstreams": [host]}).encode(),
        headers={
            "Authorization": f"Bearer {env('HERENOW_API_KEY')}",
            "X-HereNow-Client": "github-actions/dubdeck-hf",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        fail(f"here.now rejected the DUBDECK_BACKEND_KEY variable: {exc.code} {exc.read()[:300]!r}")
    print(f"here.now variable DUBDECK_BACKEND_KEY set, pinned to {host}")


def main() -> None:
    from huggingface_hub import HfApi

    token = env("HF_TOKEN")
    passcode = env("DUBDECK_OWNER_PASSCODE")
    if len(passcode) < 10:
        fail("DUBDECK_OWNER_PASSCODE must be at least 10 characters.")
    api = HfApi(token=token)
    user = api.whoami()["name"]
    space = env("HF_SPACE", required=False) or "dubdeck"
    repo_id = f"{user}/{space}"

    api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True, private=False)
    info = api.space_info(repo_id)
    host = (getattr(info, "host", None) or "").removeprefix("https://").rstrip("/")
    if not host:
        host = re.sub(r"[^a-z0-9-]", "-", f"{user}-{space}".lower()) + ".hf.space"
    print(f"Space: https://huggingface.co/spaces/{repo_id} → https://{host}")

    backend_key = env("DUBDECK_BACKEND_KEY", required=False) or derived("backend-key", token)
    signing = env("DUBDECK_SIGNING_SECRET", required=False) or derived("signing-secret", token)
    for key, value in {
        "DUBDECK_BACKEND_KEY": backend_key,
        "DUBDECK_SIGNING_SECRET": signing,
        "DUBDECK_OWNER_PASSCODE": passcode,
    }.items():
        api.add_space_secret(repo_id, key, value)
    variables = {
        "DUBDECK_PUBLIC_URL": f"https://{host}",
        "DUBDECK_EPHEMERAL": "1",
        "DUBDECK_TRUST_CF_HEADERS": "0",
    }
    owner = env("DUBDECK_OWNER_EMAIL", required=False)
    if owner:
        variables["DUBDECK_OWNER_EMAIL"] = owner
    for key, value in variables.items():
        api.add_space_variable(repo_id, key, value)

    with tempfile.TemporaryDirectory() as tmp:
        stage(Path(tmp))
        api.upload_folder(folder_path=tmp, repo_id=repo_id, repo_type="space",
                          commit_message="Deploy DubDeck backend from GitHub", delete_patterns=["*"])
    print("Uploaded; Hugging Face is building the Space (a few minutes).")

    herenow_variable(backend_key, host)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"host={host}\n")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"### Backend on Hugging Face\n\nhttps://huggingface.co/spaces/{repo_id}\n\nAPI host: `{host}`\n")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--stage":
        target = Path(sys.argv[2])
        target.mkdir(parents=True, exist_ok=True)
        stage(target)
        print(f"staged into {target}")
    else:
        main()
