#!/usr/bin/env python3
"""Load/save plugin-root .env for DataBrain hooks."""
from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = Path(os.environ.get("DATABRAIN_ENV_FILE", PLUGIN_ROOT / ".env"))
ALLOWED_KEYS = ("DATABRAIN_TOKEN", "DATABRAIN_HOST", "DATABRAIN_DISPLAY_HOST")


def _parse_value(raw: str) -> str:
    val = raw.strip()
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
        val = val[1:-1]
    return val


def load_into_environ() -> None:
    if not ENV_FILE.is_file():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw = line.split("=", 1)
        key = key.strip()
        val = _parse_value(raw)
        if key in ALLOWED_KEYS and val and not os.environ.get(key):
            os.environ[key] = val


def bash_exports() -> str:
    before = {k: os.environ.get(k) for k in ALLOWED_KEYS}
    load_into_environ()
    lines = []
    for key in ALLOWED_KEYS:
        val = os.environ.get(key)
        if val and not before.get(key):
            lines.append(f"export {key}={shlex.quote(val)}")
    return "\n".join(lines)


def save_env(key: str, val: str) -> None:
    if key not in ALLOWED_KEYS or not val:
        return
    lines: list[str] = []
    if ENV_FILE.is_file():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    found = False
    for ln in lines:
        s = ln.strip()
        if s and not s.startswith("#") and "=" in s and s.split("=", 1)[0].strip() == key:
            if not found:
                out.append(f'{key}="{val}"')
                found = True
        else:
            out.append(ln)
    if not found:
        out.append(f'{key}="{val}"')
    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")
    try:
        ENV_FILE.chmod(0o600)
    except OSError:
        pass


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "load":
        print(bash_exports())
    elif cmd == "save" and len(sys.argv) == 4:
        save_env(sys.argv[2], sys.argv[3])
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
