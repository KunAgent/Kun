#!/usr/bin/env python3
"""Validate DATABRAIN_TOKEN and fetch user-level context at session start.

Steps:
  1. Validate token presence (and optionally remote check when MGMT is enabled).
  2. When MGMT_ENABLED: POST /api/v1/mgmt_pc/chatbi/permissions -> MGMT permission.
  3. Write token + host + mgmt_info to /tmp/databrain_agent_ctx.json.

Usage:
  python scripts/get_user_context.py

Env:
  DATABRAIN_TOKEN       (required)
  DATABRAIN_HOST        (optional, default https://databrain.intlgame.com)
  DATABRAIN_DISPLAY_HOST (optional, default same as DATABRAIN_HOST)
"""
from __future__ import annotations

import json
import os
import sys

import requests

from plugin_env import load_into_environ

DATABRAIN_HOST_DEFAULT = "https://databrain.intlgame.com"
MGMT_PERMISSION_API = "/api/v1/mgmt_pc/chatbi/permissions"
CTX_FILE = "/tmp/databrain_agent_ctx.json"
TOKEN_HELP = "Get your token at https://databrain.woa.com/v2/user-center/personal-tokens-center"

# Temporarily disable MGMT: skip permissions API (saves ~2s at session start).
MGMT_ENABLED = False


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def main():
    load_into_environ()
    token = os.environ.get("DATABRAIN_TOKEN", "").strip()
    if not token:
        print(json.dumps({
            "status": "error",
            "token_valid": False,
            "error": f"DATABRAIN_TOKEN is not set. {TOKEN_HELP}",
        }, ensure_ascii=False))
        sys.exit(1)

    host = os.environ.get("DATABRAIN_HOST", DATABRAIN_HOST_DEFAULT).rstrip("/")
    display_host = os.environ.get("DATABRAIN_DISPLAY_HOST", host).rstrip("/")

    mgmt_info: dict = {}
    token_valid = True
    error: str = ""

    if MGMT_ENABLED:
        try:
            resp = requests.post(
                host + MGMT_PERMISSION_API,
                json={},
                headers=_headers(token),
                timeout=10,
            )
            if resp.status_code in (401, 403):
                print(json.dumps({
                    "status": "error",
                    "token_valid": False,
                    "error": f"Token rejected (HTTP {resp.status_code}). {TOKEN_HELP}",
                }, ensure_ascii=False))
                sys.exit(1)
            resp.raise_for_status()
            mgmt_info = resp.json().get("data") or {}
        except SystemExit:
            raise
        except Exception as exc:
            error = str(exc)
            token_valid = False

    ctx_payload = {
        "token": token,
        "databrain_host": host,
        "databrain_display_host": display_host,
        "mgmt_info": mgmt_info,
    }
    try:
        with open(CTX_FILE, "w", encoding="utf-8") as f:
            json.dump(ctx_payload, f, ensure_ascii=False)
    except Exception as exc:
        error = f"Failed to write context file: {exc}"

    if token_valid and not error:
        if MGMT_ENABLED:
            parts = ["Token verified."]
            if mgmt_info:
                parts.append("MGMT data is available.")
            else:
                parts.append(
                    "MGMT data is not available for this account "
                    "(game intelligence, dashboard, and opinion queries are unaffected)."
                )
            print(" ".join(parts))
        else:
            print("Token loaded.")
    else:
        print(json.dumps({
            "status": "partial" if token_valid else "error",
            "token_valid": token_valid,
            "has_mgmt_permission": False,
            "context_file": CTX_FILE,
            **({"error": error} if error else {}),
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
