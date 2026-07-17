#!/usr/bin/env python3
"""AI-Shifu Course CLI - Unified tool for course CRUD operations."""

import argparse
import base64
import hashlib
import json
import os
import shutil
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv, set_key

# ── Constants ──────────────────────────────────────────────────────────────────
ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

DEFAULT_BASE_URL = "https://app.ai-shifu.cn"

# Backend ERROR_CODE["server.shifu.draftConflict"] — the optimistic-lock
# conflict raised by POST .../mdflow when the cloud draft advanced past the
# client's base_revision under a *different* editor. Confirmed in the ai-shifu
# backend at src/api/error_codes.json:53 ("server.shifu.draftConflict": 4007).
# Critically, the backend returns this as HTTP 200 with code=4007 (not a 4xx),
# so api() below — which exits on any non-zero code — cannot surface it; the
# version-sync write paths route through api_conflict_aware() instead.
DRAFT_CONFLICT_CODE = 4007

# Exit codes used by the version-sync write commands so automation can tell a
# retryable conflict apart from a hard failure:
#   0 = success, 1 = hard error (api() default), 2 = conflict auto-pulled, redo
EXIT_CONFLICT = 2

# Token lifetime (matches backend TOKEN_EXPIRE_TIME = 604800 = 7 days) and the
# backend error codes that mean "token is not usable" — used by `verify` and the
# resolve_auth() early-expiry hint.
TOKEN_EXPIRE_SECONDS = 604800
_TOKEN_ERROR_CODES = frozenset({1001, 1004, 1005})
# 1001 = userNotFound, 1004 = userNotLogin, 1005 = userTokenExpired


# ── Shared Infrastructure ──────────────────────────────────────────────────────
def load_env():
    """Load environment variables from the skill's .env file."""
    if ENV_FILE.exists():
        load_dotenv(dotenv_path=ENV_FILE, override=False)


def save_env(token):
    """Persist token to the skill's .env file."""
    env_path = str(ENV_FILE)
    if not ENV_FILE.exists():
        ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
        ENV_FILE.touch(mode=0o600)
    set_key(env_path, "SHIFU_TOKEN", token)
    os.chmod(env_path, 0o600)


def _jwt_payload(token):
    """Decode the JWT payload (no verification) for a lightweight expiry hint.

    The ai-shifu JWT only carries ``user_id`` + ``time_stamp`` (no ``exp``), so a
    true expiry check requires asking the backend.  We just extract ``time_stamp``
    for a cheap early warning — the authoritative decision is in ``cmd_verify``.
    Returns None when the token cannot be parsed as a JWT.
    """
    try:
        encoded = token.split(".")[1]
        # JWT base64url: replace URL-safe chars and add padding
        encoded = encoded.replace("-", "+").replace("_", "/")
        encoded += "=" * ((4 - len(encoded) % 4) % 4)
        return json.loads(base64.b64decode(encoded))
    except Exception:
        return None


def resolve_auth(args):
    """Resolve token from CLI args or .env. Base URL is fixed to DEFAULT_BASE_URL.

    When the JWT carries a ``time_stamp`` older than 7 days, a warning is printed
    to stderr (the authoritative expiry check is the backend's DB record, so this
    is only a nudge — the call still proceeds).
    """
    token = getattr(args, "token", None) or os.environ.get("SHIFU_TOKEN")
    if not token:
        print("Error: no token available. Run 'shifu-cli.py login' first, "
              "or use --token / set SHIFU_TOKEN in .env")
        sys.exit(1)

    payload = _jwt_payload(token)
    if isinstance(payload, dict):
        ts = payload.get("time_stamp")
        if isinstance(ts, (int, float)) and (time.time() - ts) > TOKEN_EXPIRE_SECONDS:
            print("Warning: token may be expired (issued > 7 days ago). "
                  "Run `shifu-cli.py verify` to check, or `shifu-cli.py login` "
                  "to re-login.",
                  file=sys.stderr)

    return DEFAULT_BASE_URL, token


def api(base_url, token, method, path, **kwargs):
    """Make an API call, exit on error."""
    url = f"{base_url}/api/shifu{path}"
    headers = {"Cookie": f"token={token}", "Content-Type": "application/json"}
    kwargs.setdefault("timeout", 30)
    resp = getattr(requests, method)(url, headers=headers, **kwargs)
    if not resp.ok:
        print(f"API error: {method.upper()} {path} (HTTP {resp.status_code})")
        print(f"  Response: {resp.text[:500]}")
        sys.exit(1)
    data = resp.json()
    if data.get("code") != 0:
        print(f"API error: {method.upper()} {path}")
        print(f"  Response: {json.dumps(data, ensure_ascii=False)}")
        sys.exit(1)
    return data.get("data")


def api_safe(base_url, token, method, path, session=None, **kwargs):
    """Make an API call, return None on error instead of exiting.

    ``session`` is an optional :class:`requests.Session` for TCP/TLS connection
    reuse when a caller fans out many small requests (e.g. ``status`` querying
    per-lesson draft-meta), mirroring the pooling in ``_post_creator_analytics``.
    """
    url = f"{base_url}/api/shifu{path}"
    headers = {"Cookie": f"token={token}", "Content-Type": "application/json"}
    kwargs.setdefault("timeout", 30)
    http = session if session is not None else requests
    try:
        resp = getattr(http, method)(url, headers=headers, **kwargs)
        if not resp.ok:
            return None
        data = resp.json()
        if data.get("code") != 0:
            return None
        return data.get("data")
    except (requests.RequestException, json.JSONDecodeError):
        return None


def api_conflict_aware(base_url, token, method, path, **kwargs):
    """POST helper that recognizes the draft optimistic-lock conflict.

    Unlike api() — which exits on any non-zero business code — this helper
    distinguishes the three outcomes the version-sync write paths care about:

      ("ok",       data_dict)  # code == 0; e.g. {"new_revision": <int>}
      ("conflict", meta_dict)  # code == DRAFT_CONFLICT_CODE; meta_dict is
                               #   data.meta = {revision, updated_at,
                               #                updated_user{user_bid, phone}}

    Any other non-zero code, or a transport / HTTP error, is treated as a hard
    failure: it prints the response and sys.exit(1), matching api()'s contract.
    The conflict arrives as HTTP 200 + code=4007 (see DRAFT_CONFLICT_CODE), so
    resp.ok is True in that case — we branch on the business code, not status.
    """
    url = f"{base_url}/api/shifu{path}"
    headers = {"Cookie": f"token={token}", "Content-Type": "application/json"}
    kwargs.setdefault("timeout", 30)
    resp = getattr(requests, method)(url, headers=headers, **kwargs)
    if not resp.ok:
        print(f"API error: {method.upper()} {path} (HTTP {resp.status_code})")
        print(f"  Response: {resp.text[:500]}")
        sys.exit(1)
    data = resp.json()
    code = data.get("code")
    if code == 0:
        return ("ok", data.get("data") or {})
    if code == DRAFT_CONFLICT_CODE:
        meta = ((data.get("data") or {}).get("meta")) or {}
        return ("conflict", meta)
    print(f"API error: {method.upper()} {path}")
    print(f"  Response: {json.dumps(data, ensure_ascii=False)}")
    sys.exit(1)


def api_upload(base_url, token, filename, file_bytes, mime, resource_id=None):
    """POST multipart to /api/shifu/upfile. Exits on transport / business error.

    Kept separate from api() because requests must control the multipart
    Content-Type (with boundary) itself — api() pins application/json.
    """
    url = f"{base_url}/api/shifu/upfile"
    headers = {"Cookie": f"token={token}"}
    files = {"file": (filename, file_bytes, mime)}
    data = {"resource_id": resource_id} if resource_id else None
    try:
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=60)
    except requests.RequestException as e:
        print(f"API transport error: POST /upfile ({e})")
        sys.exit(1)
    if not resp.ok:
        print(f"API error: POST /upfile (HTTP {resp.status_code})")
        print(f"  Response: {resp.text[:500]}")
        sys.exit(1)
    try:
        payload = resp.json()
    except json.JSONDecodeError:
        print("API error: POST /upfile returned non-JSON response")
        print(f"  Response: {resp.text[:500]}")
        sys.exit(1)
    if payload.get("code") != 0:
        print("API error: POST /upfile")
        print(f"  Response: {json.dumps(payload, ensure_ascii=False)}")
        sys.exit(1)
    return payload.get("data")


def _post_creator_analytics(base_url, token, path, body, session=None):
    """POST to a /api/creator-analytics/<path> endpoint with auth headers.

    Shared transport helper for the DSL query and credit-detail endpoints.
    Returns (transport_ok, payload). Non-zero business codes do NOT raise —
    callers need to surface them. ``session`` is an optional
    :class:`requests.Session` for TCP / TLS connection reuse when the caller
    is fanning out many small queries.
    """

    # Tolerate `path` with or without a leading slash — callers in this
    # file consistently pass "/query" / "/credit-detail", but stripping
    # guards against a future caller forgetting the slash, which would
    # otherwise produce "/api/creator-analyticsquery". Flagged on PR #49
    # review.
    url = f"{base_url}/api/creator-analytics/{path.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Token": token,
        "Content-Type": "application/json",
    }
    http = session if session is not None else requests
    try:
        resp = http.post(url, headers=headers, json=body, timeout=30)
    except requests.RequestException as e:
        return False, {"transport_error": str(e)}
    if not resp.ok:
        return False, {"http_status": resp.status_code, "text": resp.text[:1000]}
    try:
        return True, resp.json()
    except json.JSONDecodeError:
        return False, {"parse_error": "non-JSON response", "text": resp.text[:1000]}


def api_analytics(base_url, token, body, session=None):
    """POST a DSL query to /api/creator-analytics/query."""
    return _post_creator_analytics(base_url, token, "/query", body, session=session)


def api_credit_detail(base_url, token, body, session=None):
    """POST to /api/creator-analytics/credit-detail.

    Unlike ``api_analytics``, this endpoint is not DSL-based — it expects a
    fixed schema (``shifu_bid`` + optional date/scene/type filters and
    pagination) and the backend handles the bill_usage x credit_ledger_entries
    join server-side. See ``cmd_credit_detail`` for the CLI surface.
    """
    return _post_creator_analytics(
        base_url, token, "/credit-detail", body, session=session
    )


def safe_join_path(base_dir, filename):
    """Safely join base_dir and filename, preventing path traversal attacks."""
    joined = os.path.realpath(os.path.join(base_dir, filename))
    base = os.path.realpath(base_dir)
    if not joined.startswith(base + os.sep) and joined != base:
        print(f"Warning: path traversal detected, rejecting: {filename}")
        return None
    return joined


def fmt_time(ts):
    """Format an ISO timestamp for display, return '' if missing."""
    if not ts:
        return ""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ts[:16] if len(ts) >= 16 else ts


def _print_verification_urls(base_url, shifu_bid, include_published=False):
    """Print admin + course preview, and (when published) the public URL.

    Skill docs instruct the LLM to transcribe these lines verbatim. Do not
    let the LLM reconstruct URLs from a template — that has historically led
    to wrong path (/shifu vs /c) and wrong param name (outline_bid vs lessonid).

    `include_published=True` adds the public student-facing URL (no preview
    query param). Callers should set it only when the course is known to be
    in a published state (e.g. right after `publish`, or in `show` which
    queries existing courses that are typically already published).
    Lesson-level URLs are intentionally not printed — they bloat reports for
    multi-lesson courses; build one on demand via `show <shifu_bid>` if needed.
    """
    print("\nVerification URLs:")
    print(f"  Admin console:    {base_url}/shifu/{shifu_bid}")
    print("    # 点击会跳转到 AI 师傅管理后台，用于设置章节状态、收费与否，以及手工调整课程细节、调试 AI 一对一授课的效果。调试时会消耗课程创建者在 AI 师傅的积分。")
    print(f"  Course preview:   {base_url}/c/{shifu_bid}?preview=true")
    print("    # 点击会跳转到 AI 师傅课程预览页，仅课程作者本人可见，用于正式发布前自测课程草稿的效果；预览会消耗课程创建者在 AI 师傅的积分。")
    if include_published:
        print(f"  Published URL:    {base_url}/c/{shifu_bid}")
        print("    # 点击会跳转到 AI 师傅课程学习页，可以发送给学员使用且仅在课程已发布后有效；任何人学习都会消耗课程创建者在 AI 师傅的积分。")


# ── Version Sync Manifest (.shifu-sync.json) ────────────────────────────────────
# Persists the local↔cloud version link for a course directory: shifu_bid, the
# course-level draft revision, and per-lesson {file, outline_bid, revision}. This
# is what lets the write commands behave like `git push` — compare the recorded
# baseline against the cloud head before uploading, instead of blindly taking the
# latest cloud revision (which never detects a concurrent edit). Atomic-write
# semantics mirror the image-manifest helpers (_write_manifest, below).
SYNC_MANIFEST_NAME = ".shifu-sync.json"


def _now_iso():
    """UTC timestamp, second precision, Z-suffixed — matches image-manifest style."""
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def _mask_phone(phone):
    """Mask a phone/contact for display (3 head + 4 tail), mirroring cmd_login."""
    if not phone:
        return ""
    return phone[:3] + "****" + phone[-4:] if len(phone) >= 7 else phone


def _sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_file(path):
    """Hash a lesson file as utf-8 text (matches how pull writes it). None if missing."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return _sha256_text(f.read())
    except (OSError, UnicodeDecodeError):
        return None


def _sync_path(course_dir):
    return Path(course_dir) / SYNC_MANIFEST_NAME


def _load_sync(course_dir):
    """Load .shifu-sync.json, or None when absent/corrupt so callers fall back.

    Returning None (rather than a default skeleton) lets a command tell
    "no manifest → legacy behavior" apart from "manifest exists, use it".
    """
    if not course_dir:
        return None
    path = _sync_path(course_dir)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("lessons"), list):
        return None
    return data


def _write_sync(course_dir, manifest):
    """Atomically write the sync manifest (write .tmp then replace)."""
    path = _sync_path(course_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(path)


def _sync_lesson_by_bid(manifest, outline_bid):
    for item in manifest.get("lessons", []):
        if item.get("outline_bid") == outline_bid:
            return item
    return None


def _sync_lesson_by_file(manifest, rel_file):
    for item in manifest.get("lessons", []):
        if item.get("file") == rel_file:
            return item
    return None


def _set_lesson_revision(manifest, outline_bid, revision, name=None, content_sha256=None):
    """Upsert the revision (and optionally name / content hash) for an outline."""
    entry = _sync_lesson_by_bid(manifest, outline_bid)
    if entry is None:
        entry = {
            "file": None, "outline_bid": outline_bid, "name": name,
            "parent_bid": "", "revision": revision, "is_chapter": False,
            "content_sha256": content_sha256,
        }
        manifest.setdefault("lessons", []).append(entry)
    else:
        entry["revision"] = revision
        if name is not None:
            entry["name"] = name
        if content_sha256 is not None:
            entry["content_sha256"] = content_sha256
    return entry


# ── Login ──────────────────────────────────────────────────────────────────────
def _login_post(base_url, path, payload, error_prefix):
    """POST to a user-auth endpoint and return parsed JSON, exit on failure."""
    resp = requests.post(
        f"{base_url}{path}",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    if not resp.ok:
        print(f"{error_prefix} (HTTP {resp.status_code}): {resp.text[:200]}")
        sys.exit(1)
    data = resp.json()
    if data.get("code") != 0:
        print(f"{error_prefix}: {data}")
        sys.exit(1)
    return data


def cmd_login(args):
    """SMS login and save token (non-interactive two-step flow)."""
    base_url = DEFAULT_BASE_URL

    phone = args.phone
    if not phone:
        print("Error: --phone is required for login")
        sys.exit(1)

    sms_code = args.sms_code
    masked = phone[:3] + "****" + phone[-4:] if len(phone) >= 7 else phone

    if sms_code:
        # Step 2: Verify code and save token
        print("Verifying code...")
        data = _login_post(base_url, "/api/user/login_sms",
                           {"mobile": phone, "sms_code": sms_code, "login_context": "admin"}, "Verification failed")

        token = data.get("data")
        if not token:
            print(f"No token in response: {data}")
            sys.exit(1)
        # API may return token as a dict (e.g. {"token": "..."}) or a plain string
        if isinstance(token, dict):
            token = token.get("token", "")
        if not token:
            print(f"No token string found in response data: {data}")
            sys.exit(1)

        save_env(token)
        print(f"Login successful! Token saved to {ENV_FILE}")
    else:
        # Step 1: Send SMS code only, then exit
        print(f"Sending SMS code to {masked}...")
        _login_post(base_url, "/api/user/console_send_sms_code",
                    {"mobile": phone}, "Failed to send SMS")
        print(f"SMS code sent to {masked}. "
              f"Run again with --sms-code <4-digit-code> to complete login.")


# ── Verify Token ────────────────────────────────────────────────────────────────
def cmd_verify(args):
    """Check whether the stored token is still valid, using a lightweight API call.

    Exit codes:
      0 — token is valid (API accepted it)
      1 — token is expired / invalid (error codes 1001 / 1004 / 1005)
      2 — unknown (network / service error — cannot determine)
    """
    base_url, token = resolve_auth(args)
    try:
        url = f"{base_url}/api/shifu/shifus?limit=1"
        headers = {"Cookie": f"token={token}", "Content-Type": "application/json"}
        resp = requests.get(url, headers=headers, timeout=15)
    except requests.RequestException as e:
        print(f"Token status: unknown (network error: {e})")
        sys.exit(2)
    if not resp.ok:
        # A gateway/proxy can reject a bad token before the app runs — 401/403
        # definitively mean "not authenticated", so report expired (exit 1) so the
        # agent re-logins instead of retrying forever as if it were a network blip.
        if resp.status_code in (401, 403):
            print("Token is expired or invalid — re-run `shifu-cli.py login`")
            sys.exit(1)
        print(f"Token status: unknown (HTTP {resp.status_code})")
        sys.exit(2)
    try:
        data = resp.json()
    except ValueError:
        print("Token status: unknown (invalid JSON response)")
        sys.exit(2)
    if not isinstance(data, dict):
        print("Token status: unknown (unexpected JSON response)")
        sys.exit(2)
    code = data.get("code")
    if code == 0:
        print("Token is valid")
        sys.exit(0)
    if code in _TOKEN_ERROR_CODES:
        print("Token is expired or invalid — re-run `shifu-cli.py login`")
        sys.exit(1)
    # Any other business code (e.g. no courses) — the token was recognised.
    print(f"Token is valid (API returned code {code})")
    sys.exit(0)


# ── List ───────────────────────────────────────────────────────────────────────
def _fetch_shifu_title(base_url, token, shifu_bid, *, table_key, session=None):
    """Fetch the current title from one of the shifu metadata tables.

    ``table_key`` selects which side of the published/draft pair to query:
    ``shifu_published_shifus`` for the live learner-facing title (Recipe
    0b) or ``shifu_draft_shifus`` for the editor copy (Recipe 0c).
    Returns the title string, or ``None`` when there is no current row
    (typically: course is unpublished, or never had a draft saved).

    ``session`` is passed through to :func:`api_analytics` to enable
    TCP/TLS connection reuse when the caller is doing one lookup per
    shifu_bid in a tight loop.
    """

    body = {
        "shifu_bid": shifu_bid,
        "table": table_key,
        "select": ["title"],
        "limit": 1,
    }
    ok, payload = api_analytics(base_url, token, body, session=session)
    if not ok or not isinstance(payload, dict) or payload.get("code") != 0:
        return None
    data = payload.get("data") or {}
    rows = data.get("rows") or []
    columns = data.get("columns") or []
    if not rows:
        return None
    try:
        title_idx = columns.index("title")
    except ValueError:
        return None
    return rows[0][title_idx]


def cmd_list(args):
    """List all courses with both draft and published titles.

    The /shifus endpoint returns the draft snapshot; we additionally run
    one analytics Recipe 0b call per shifu_bid to fetch the live published
    title. When the two diverge, the author has renamed the draft and has
    not yet republished — surface this so downstream agents do not mistake
    the draft title for the live learner-facing title.
    """
    base_url, token = resolve_auth(args)
    result = api(base_url, token, "get", "/shifus")

    if not result:
        print("No courses found.")
        return

    courses = result if isinstance(result, list) else result.get("items", [])
    if not courses:
        print("No courses found.")
        return

    rows = []
    diverged = 0
    # Reuse a single requests.Session for the per-course metadata lookups.
    # This avoids a fresh TCP / TLS handshake for every shifu_bid when the
    # author owns many courses; the handshake itself dominates latency on
    # a remote API, so connection pooling alone shaves the wall time
    # roughly in half without adding concurrency complexity.
    with requests.Session() as session:
        for c in courses:
            bid = c.get("bid", c.get("shifu_bid", ""))
            draft = c.get("name", c.get("title", ""))
            published = (
                _fetch_shifu_title(
                    base_url,
                    token,
                    bid,
                    table_key="shifu_published_shifus",
                    session=session,
                )
                if bid
                else None
            )
            if published is None:
                published_disp = "(draft only)"
            elif published == draft:
                published_disp = "(same)"
            else:
                published_disp = published
                diverged += 1
            rows.append({
                "bid": bid,
                "draft": draft,
                "published_disp": published_disp,
                "status": c.get("status", ""),
                "updated": fmt_time(c.get("updated_at", "")),
            })

    # Table output
    print(f"{'BID':<34} {'Draft Name':<26} {'Published Name':<26} {'Status':<10} {'Updated':<18}")
    print("-" * 116)
    for r in rows:
        print(
            f"{r['bid']:<34} {r['draft'][:24]:<26} {r['published_disp'][:24]:<26} "
            f"{r['status']:<10} {r['updated']:<18}"
        )

    print(f"\nTotal: {len(courses)} courses ({diverged} with draft/published title divergence)")


# ── Show ───────────────────────────────────────────────────────────────────────
def cmd_show(args):
    """Show course detail / outline tree / MarkdownFlow content."""
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid
    outline_bid = args.outline_bid

    if outline_bid:
        # Show MarkdownFlow content for a specific lesson
        result = api(base_url, token, "get",
                     f"/shifus/{shifu_bid}/outlines/{outline_bid}/mdflow")
        content = result.get("data", "") if isinstance(result, dict) else result
        revision = result.get("revision", "") if isinstance(result, dict) else ""
        if revision:
            print(f"# Revision: {revision}\n")
        print(content)
    else:
        # Show course detail + outline tree
        detail = api_safe(base_url, token, "get", f"/shifus/{shifu_bid}/detail")
        if detail:
            print(f"Course: {detail.get('name', '')}")
            print(f"BID:    {shifu_bid}")
            desc = detail.get("description", "")
            if desc:
                print(f"Desc:   {desc}")
            model = detail.get("model", "")
            if model:
                print(f"Model:  {model}")
            print()

        tree = api(base_url, token, "get", f"/shifus/{shifu_bid}/outlines")
        if not tree:
            print("No outlines found.")
            return

        def print_tree(items, indent=0):
            for item in items:
                prefix = "  " * indent
                bid = item.get("bid", "")
                name = item.get("name", "")
                print(f"{prefix}- [{bid}] {name}")
                children = item.get("children", [])
                if children:
                    print_tree(children, indent + 1)

        print("Outline tree:")
        print_tree(tree if isinstance(tree, list) else [tree])

        _print_verification_urls(base_url, shifu_bid, include_published=True)


# ── History ────────────────────────────────────────────────────────────────────
def cmd_history(args):
    """Show MarkdownFlow revision history for a lesson."""
    base_url, token = resolve_auth(args)
    result = api(base_url, token, "get",
                 f"/shifus/{args.shifu_bid}/outlines/{args.outline_bid}/mdflow/history")

    if not result:
        print("No history found.")
        return

    items = result if isinstance(result, list) else result.get("items", [])
    for item in items:
        rev = item.get("revision", "")
        ts = fmt_time(item.get("created_at", ""))
        user = item.get("created_user_bid", "")
        print(f"  {rev}  {ts}  by {user}")


# ── Export ─────────────────────────────────────────────────────────────────────
def cmd_export(args):
    """Export a course to JSON via backend export API."""
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid

    # Backend export API returns a file download (not standard JSON envelope)
    url = f"{base_url}/api/shifu/shifus/{shifu_bid}/export"
    headers = {"Cookie": f"token={token}"}
    resp = requests.get(url, headers=headers, timeout=60)

    if resp.status_code != 200:
        print(f"Export failed (HTTP {resp.status_code})")
        try:
            print(f"  Response: {resp.json()}")
        except Exception:
            print(f"  Response: {resp.text[:200]}")
        sys.exit(1)

    if args.output:
        outpath = args.output
        os.makedirs(os.path.dirname(outpath) or ".", exist_ok=True)
        with open(outpath, "wb") as f:
            f.write(resp.content)
        # Count lessons from exported data
        try:
            data = resp.json()
            count = len(data.get("outline_items", []))
            print(f"Exported to {outpath} ({count} lessons)")
        except Exception:
            print(f"Exported to {outpath}")
    else:
        # Pretty-print to stdout
        try:
            data = resp.json()
            print(json.dumps(data, ensure_ascii=False, indent=2))
        except Exception:
            print(resp.text)


# ── Course Attributes (round-trip via structure.json + course-config.json) ──────
COURSE_DESCRIPTION_NAME = "course-description.md"
COURSE_CONFIG_NAME = "course-config.json"

# Per-lesson learning-access type ("guest"/"trial"/"normal") <-> the Chinese the
# editor shows. guest = 无需登录, trial = 试看(需登录), normal = 需付费.
ACCESS_TYPES = ("guest", "trial", "normal")

# Course-level attributes that round-trip through course-config.json. The course
# name lives in README.md, the SEO description in course-description.md, and the
# system prompt in course-prompt.md, so they are intentionally NOT duplicated
# here.
COURSE_CONFIG_DEFAULTS = {
    "model": "", "temperature": 0.3, "price": 0, "keywords": [], "avatar": "",
    "use_learner_language": False,
    "tts_enabled": False, "tts_provider": "minimax", "tts_model": "",
    "tts_voice_id": "", "tts_speed": 1.0, "tts_pitch": 0, "tts_emotion": "",
    "ask_enabled_status": 5101, "ask_model": "", "ask_temperature": 0.0,
    "ask_system_prompt": "", "ask_provider_config": {},
}


def _normalize_keywords(value):
    """Coerce keywords to a list — some endpoints return a comma-joined string."""
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return [k.strip() for k in value.split(",") if k.strip()]
    return []


def _course_config_from_detail(detail):
    """Extract the round-trippable course-level attributes from a /detail dict."""
    cfg = {}
    for k, default in COURSE_CONFIG_DEFAULTS.items():
        val = detail.get(k)
        cfg[k] = val if val is not None else default
    cfg["keywords"] = _normalize_keywords(cfg.get("keywords"))
    return cfg


def _write_course_config(course_dir, cfg):
    """Atomically write course-config.json (tmp + replace, same as _write_sync)."""
    path = Path(course_dir) / COURSE_CONFIG_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    tmp.replace(path)


def _read_text_file(path, *, label):
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError) as e:
        print(f"Error: cannot read {label}: {e}")
        sys.exit(1)


def _resolve_course_description(course_dir=None, description=None):
    """Resolve course description precedence for build/import/update-meta."""
    if description is not None:
        return description
    if course_dir:
        path = Path(course_dir) / COURSE_DESCRIPTION_NAME
        if path.exists():
            return _read_text_file(path, label=str(path))
    return ""


def _write_course_description(course_dir, description):
    """Atomically write the local SEO description file."""
    path = Path(course_dir) / COURSE_DESCRIPTION_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(description or "", encoding="utf-8")
    tmp.replace(path)


# ── Pull / Status / Auto-Pull (Version Sync) ────────────────────────────────────
def _flatten_outline_tree(tree):
    """Depth-first flatten of the outline tree, preserving sibling order.

    Returns a list of {bid, name, parent_bid, is_chapter, access, hidden}. A node
    is a chapter container (no MarkdownFlow content) when it has children OR sits
    at the top level; everything else is a leaf lesson. This mirrors the 2-level
    chapter→lesson shape that `_build_import_json` produces. `access` is the
    lesson's learning-access type ("guest"/"trial"/"normal") and `hidden` its
    visibility — captured so a later build/import can round-trip them faithfully
    (the platform otherwise resets them to defaults on re-import).
    """
    flat = []

    def walk(items, parent_bid, depth):
        for it in (items or []):
            if not isinstance(it, dict):
                continue
            bid = it.get("bid") or it.get("outline_item_bid") or ""
            if not bid:
                continue
            children = it.get("children", []) or []
            flat.append({
                "bid": bid,
                "name": it.get("name", ""),
                "parent_bid": parent_bid,
                "is_chapter": bool(children) or depth == 0,
                "access": it.get("type"),
                "hidden": bool(it.get("is_hidden")),
            })
            if children:
                walk(children, bid, depth + 1)

    walk(tree if isinstance(tree, list) else [tree], "", 0)
    return flat


def _pull_into_dir(base_url, token, shifu_bid, course_dir, *, backup=True, force=False):
    """Fetch detail + outline tree + every lesson's mdflow + course draft-meta,
    write them into the course directory, and (re)write .shifu-sync.json.

    This is the single "cloud → local" writer, reused by `pull`, by import's
    manifest re-seed, and by _auto_pull_overwrite's recovery step. Returns the
    freshly written manifest dict.

    backup: when True, any local file that diverges from the incoming cloud
            content is copied to "<file>.local-<ts>.bak" before being
            overwritten, so a forgotten local edit is never silently lost.
    force:  when True, skip those backups and also overwrite README.md
            (otherwise README is written only when absent, to preserve any
            author notes beyond the title line).
    """
    course_path = Path(course_dir)
    (course_path / "lessons").mkdir(parents=True, exist_ok=True)
    ts = _now_iso().replace(":", "").replace("-", "")

    detail = api(base_url, token, "get", f"/shifus/{shifu_bid}/detail")
    if not isinstance(detail, dict):
        detail = {}
    tree = api(base_url, token, "get", f"/shifus/{shifu_bid}/outlines")
    course_meta = api_safe(base_url, token, "get",
                           f"/shifus/{shifu_bid}/draft-meta") or {}

    existing = _load_sync(course_dir)
    existing_by_bid = {}
    if existing:
        for e in existing.get("lessons", []):
            if e.get("outline_bid"):
                existing_by_bid[e["outline_bid"]] = e

    flat = _flatten_outline_tree(tree)

    # Assign stable lesson filenames: reuse a prior manifest filename for the
    # same outline_bid, otherwise pick the next free lesson-NN.md.
    used_files = set()
    for node in flat:
        if not node["is_chapter"]:
            prev = existing_by_bid.get(node["bid"])
            if prev and prev.get("file"):
                used_files.add(prev["file"])

    def _next_free_lesson():
        i = 1
        while True:
            cand = f"lessons/lesson-{i:02d}.md"
            if cand not in used_files:
                used_files.add(cand)
                return cand
            i += 1

    def _backup_if_divergent(dest_path, incoming):
        if force or not backup or not dest_path.exists():
            return
        try:
            cur = dest_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return
        if cur != incoming:
            bak = dest_path.with_name(dest_path.name + f".local-{ts}.bak")
            bak.write_text(cur, encoding="utf-8")
            print(f"  backed up local edit: {dest_path.name} -> {bak.name}",
                  file=sys.stderr)

    manifest_lessons = []
    for node in flat:
        if node["is_chapter"]:
            manifest_lessons.append({
                "file": None, "outline_bid": node["bid"], "name": node["name"],
                "parent_bid": node["parent_bid"], "revision": None,
                "is_chapter": True, "content_sha256": None,
            })
            continue
        md = api(base_url, token, "get",
                 f"/shifus/{shifu_bid}/outlines/{node['bid']}/mdflow")
        if isinstance(md, dict):
            content = md.get("data", "") or ""
            revision = md.get("revision")
        else:
            content, revision = (md or ""), None
        prev = existing_by_bid.get(node["bid"])
        relfile = prev["file"] if (prev and prev.get("file")) else _next_free_lesson()
        dest = safe_join_path(str(course_path), relfile)
        if dest is not None:
            destp = Path(dest)
            _backup_if_divergent(destp, content)
            destp.parent.mkdir(parents=True, exist_ok=True)
            destp.write_text(content, encoding="utf-8")
            manifest_file, content_hash = relfile, _sha256_text(content)
        else:
            # safe_join_path rejected the path (e.g. a corrupt prior manifest's
            # file value) — the file was not written, so don't claim it exists.
            manifest_file, content_hash = None, None
        manifest_lessons.append({
            "file": manifest_file, "outline_bid": node["bid"], "name": node["name"],
            "parent_bid": node["parent_bid"], "revision": revision,
            "is_chapter": False, "content_sha256": content_hash,
        })

    # README.md — keep the title in sync with the cloud course name. The first
    # heading is what `build` uses as the course title, so a stale heading would
    # otherwise be pushed back up on the next import. Preserve any author body
    # below the heading; only the title line is rewritten (full write if absent).
    name = detail.get("name", "")
    readme = course_path / "README.md"
    if force or not readme.exists():
        readme.write_text(f"# {name}\n", encoding="utf-8")
    else:
        lines = readme.read_text(encoding="utf-8").splitlines()
        if lines and lines[0].lstrip().startswith("#"):
            lines[0] = f"# {name}"
        else:
            lines.insert(0, f"# {name}")
        readme.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    # course-description.md — cloud-authoritative SEO/course listing summary.
    course_description = detail.get("description", "") or ""
    desc_path = course_path / COURSE_DESCRIPTION_NAME
    _backup_if_divergent(desc_path, course_description)
    _write_course_description(course_dir, course_description)

    # course-prompt.md — cloud-authoritative system prompt.
    course_prompt = detail.get("system_prompt", "") or ""
    cp_path = course_path / "course-prompt.md"
    _backup_if_divergent(cp_path, course_prompt)
    cp_path.write_text(course_prompt, encoding="utf-8")

    # structure.json — regenerate the chapter→lesson shape so a later `build`
    # reproduces the same tree. Each lesson also carries its `access` (learning
    # permission) and `hidden` so build/import restore them instead of letting
    # the platform reset every lesson to "guest" (无需登录). `file` is relative
    # to lessons/ per the spec.
    bid_to_relfile = {}
    for entry in manifest_lessons:
        if entry.get("file"):
            bid_to_relfile[entry["outline_bid"]] = entry["file"]
    chapters = []
    for ch in [n for n in flat if n["is_chapter"] and n["parent_bid"] == ""]:
        ch_lessons = []
        for n in flat:
            if not n["is_chapter"] and n["parent_bid"] == ch["bid"]:
                relfile = bid_to_relfile.get(n["bid"], "")
                fname = relfile.split("/", 1)[1] if relfile.startswith("lessons/") else relfile
                if fname:
                    ch_lessons.append({
                        "file": fname, "title": n["name"],
                        "access": n.get("access") or "guest",
                        "hidden": bool(n.get("hidden")),
                    })
        chapters.append({"title": ch["name"], "lessons": ch_lessons})
    (course_path / "structure.json").write_text(
        json.dumps({"chapters": chapters}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")

    # course-config.json — cloud-authoritative course-level attributes (model,
    # price, TTS, Ask, …) so a later build/import restores them faithfully
    # instead of overwriting the cloud with hard-coded defaults.
    _write_course_config(course_dir, _course_config_from_detail(detail))

    manifest = {
        "schema_version": 1,
        "shifu_bid": shifu_bid,
        "base_url": base_url,
        "course": {
            "revision": course_meta.get("revision"),
            "name": name,
            "description": course_description,
            "updated_at": course_meta.get("updated_at"),
            "updated_user_bid": (course_meta.get("updated_user") or {}).get("user_bid"),
        },
        "lessons": manifest_lessons,
        "last_pull_at": _now_iso(),
        "last_push_at": existing.get("last_push_at") if existing else None,
    }
    if existing and existing.get("published"):
        manifest["published"] = existing["published"]
    _write_sync(course_dir, manifest)
    return manifest


def cmd_pull(args):
    """Pull a course from the platform into a local course directory (git pull)."""
    base_url, token = resolve_auth(args)
    manifest = _pull_into_dir(base_url, token, args.shifu_bid, args.course_dir,
                              backup=not args.force, force=args.force)
    lessons = [x for x in manifest["lessons"] if not x.get("is_chapter")]
    chapters = [x for x in manifest["lessons"] if x.get("is_chapter")]
    print(f"Pulled {args.shifu_bid} into {args.course_dir}")
    print(f"  Course: {manifest['course'].get('name', '')}  "
          f"(revision {manifest['course'].get('revision')})")
    print(f"  Chapters: {len(chapters)}, Lessons: {len(lessons)}")
    print(f"  Manifest: {_sync_path(args.course_dir)}")
    _print_verification_urls(base_url, args.shifu_bid)


def cmd_status(args):
    """Compare the local sync manifest against cloud revisions (git status)."""
    base_url, token = resolve_auth(args)
    course_dir = args.course_dir
    manifest = _load_sync(course_dir)
    if not manifest:
        print(f"No {SYNC_MANIFEST_NAME} in {course_dir}. "
              f"Run `pull <shifu_bid> --course-dir {course_dir}` first.")
        sys.exit(1)
    shifu_bid = manifest.get("shifu_bid")

    course_meta = api_safe(base_url, token, "get",
                           f"/shifus/{shifu_bid}/draft-meta") or {}
    cloud_course_rev = course_meta.get("revision")
    local_course_rev = (manifest.get("course") or {}).get("revision")

    tree = api(base_url, token, "get", f"/shifus/{shifu_bid}/outlines")
    cloud_bids = set()

    def _collect(items):
        for it in (items or []):
            b = it.get("bid") or it.get("outline_item_bid")
            if b:
                cloud_bids.add(b)
            _collect(it.get("children"))

    _collect(tree if isinstance(tree, list) else [tree])

    behind, locally_modified, deleted_remote = [], [], []
    course_locally_modified = []
    manifest_bids = set()
    uptodate = 0

    desc_path = Path(course_dir) / COURSE_DESCRIPTION_NAME
    manifest_course = manifest.get("course") or {}
    manifest_description = manifest_course.get("description")
    if manifest_description is None:
        manifest_description = ""
    if desc_path.exists():
        try:
            local_description = desc_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            local_description = None
        if (local_description is None
                or local_description.strip() != manifest_description.strip()):
            course_locally_modified.append(COURSE_DESCRIPTION_NAME)
    elif manifest_description:
        course_locally_modified.append(COURSE_DESCRIPTION_NAME)

    # Reuse one connection for the per-lesson draft-meta lookups — on a remote
    # API the TCP/TLS handshake dominates, so pooling roughly halves wall time
    # for multi-lesson courses (same pattern as cmd_list / cmd_find_title).
    with requests.Session() as session:
        for entry in manifest.get("lessons", []):
            bid = entry.get("outline_bid")
            if bid:
                manifest_bids.add(bid)
            if entry.get("is_chapter"):
                continue
            if bid not in cloud_bids:
                deleted_remote.append(entry)
                continue
            meta = api_safe(base_url, token, "get",
                            f"/shifus/{shifu_bid}/draft-meta?outline_bid={bid}",
                            session=session) or {}
            cloud_rev = meta.get("revision")
            local_rev = entry.get("revision")
            is_behind = (cloud_rev is not None and local_rev is not None
                         and cloud_rev > local_rev)
            if is_behind:
                behind.append((entry, local_rev, cloud_rev, meta))
            # Local edit detection via content hash.
            is_local_mod = False
            if entry.get("file"):
                dest = safe_join_path(course_dir, entry["file"])
                cur_hash = _sha256_file(dest) if dest else None
                if (cur_hash is not None and entry.get("content_sha256")
                        and cur_hash != entry["content_sha256"]):
                    locally_modified.append(entry)
                    is_local_mod = True
            if not is_behind and not is_local_mod:
                uptodate += 1
    new_remote = sorted(cloud_bids - manifest_bids)

    print(f"Course: {manifest['course'].get('name', '')}  (shifu_bid {shifu_bid})")
    if cloud_course_rev is None:
        print("Course meta: unknown (failed to fetch cloud revision)")
    elif local_course_rev is not None and cloud_course_rev > local_course_rev:
        print(f"Course meta: BEHIND (local rev {local_course_rev} < cloud {cloud_course_rev}) "
              f"— run `pull`")
    else:
        print(f"Course meta: up to date (revision {local_course_rev})")

    if behind:
        print("\nBehind (cloud changed — run `pull`; your local copy is stale):")
        for entry, lr, cr, meta in behind:
            who = _mask_phone((meta.get("updated_user") or {}).get("phone")) \
                or (meta.get("updated_user") or {}).get("user_bid") or "?"
            print(f"  {entry.get('file') or entry.get('outline_bid')}   "
                  f"{entry.get('name', '')}   local rev {lr} < cloud {cr}   (by {who})")
    if locally_modified:
        print("\nLocally modified (will be pushed on next update-lesson / import):")
        for entry in locally_modified:
            print(f"  {entry.get('file')}   {entry.get('name', '')}")
    if course_locally_modified:
        print("\nCourse metadata locally modified "
              "(will be pushed on next update-meta / import):")
        for relfile in course_locally_modified:
            print(f"  {relfile}   description")
    if new_remote:
        print("\nNew on server (not in local manifest — run `pull`):")
        for b in new_remote:
            print(f"  [bid {b}]")
    if deleted_remote:
        print("\nDeleted on server:")
        for entry in deleted_remote:
            print(f"  {entry.get('file') or entry.get('outline_bid')}   {entry.get('name', '')}")
    print(f"\nUp to date: {uptodate} lessons")

    # A locally-modified working tree counts as diverged too, so `status
    # --exit-code` can guard import/push automation against unsynced edits.
    diverged = bool(
        behind or new_remote or deleted_remote or locally_modified
        or course_locally_modified
    ) or (cloud_course_rev is not None and local_course_rev is not None
          and cloud_course_rev > local_course_rev)
    if getattr(args, "exit_code", False) and diverged:
        sys.exit(1)


def _auto_pull_overwrite(base_url, token, shifu_bid, course_dir, *, scope,
                         outline_bid=None, attempted_content=None,
                         local_file=None, intended_meta=None, conflict_meta=None):
    """Cloud-wins recovery shared by the version-guarded write commands.

    Backs up the local pending work (so nothing is lost), pulls the cloud copy
    over local, then prints actionable guidance. NEVER overwrites the cloud and
    NEVER silently drops local edits. scope ∈ {"lesson", "meta", "import"} only
    selects how the pending work is backed up; the cloud refresh is always the
    whole course (a conflict means the manifest's revisions are broadly stale).
    Callers must sys.exit(EXIT_CONFLICT) after this returns.
    """
    if not course_dir:
        print("\n⚠ Conflict: the course was changed on the server, but no "
              "--course-dir was given so the local copy cannot be auto-pulled.\n"
              "  Re-run with --course-dir to enable version sync, then retry.",
              file=sys.stderr)
        return

    ts = _now_iso().replace(":", "").replace("-", "")
    course_path = Path(course_dir)
    backup_location = None

    if scope == "lesson" and attempted_content is not None:
        # Always persist the attempted edit before the pull overwrites local —
        # even when the lesson has no manifest mapping (local_file is None), in
        # which case fall back to a deterministic conflict file in the course dir
        # so the pending content is never lost.
        dest = safe_join_path(course_dir, local_file) if local_file else None
        if dest:
            destp = Path(dest)
            bak = destp.with_name(destp.name + ".conflict")
            if bak.exists():
                bak = destp.with_name(destp.name + f".conflict-{ts}")
        else:
            stem = outline_bid or "lesson"
            bak = course_path / f".{stem}.conflict.md"
            if bak.exists():
                bak = course_path / f".{stem}.conflict-{ts}.md"
        bak.parent.mkdir(parents=True, exist_ok=True)
        bak.write_text(attempted_content, encoding="utf-8")
        backup_location = str(bak)
    elif scope == "meta":
        bakp = course_path / ".shifu-meta.conflict.json"
        bakp.write_text(
            json.dumps(intended_meta or {}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        backup_location = str(bakp)
    elif scope == "import":
        backup_dir = course_path / f".conflict-backup-{ts}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        for rel in ("README.md", COURSE_DESCRIPTION_NAME, "course-prompt.md",
                    "structure.json", COURSE_CONFIG_NAME):
            src = course_path / rel
            if src.exists():
                shutil.copy2(src, backup_dir / rel)
        lessons_src = course_path / "lessons"
        if lessons_src.is_dir():
            shutil.copytree(lessons_src, backup_dir / "lessons", dirs_exist_ok=True)
        backup_location = str(backup_dir)

    # Pull cloud over local. For lesson/meta scope, backup=True so any *other*
    # divergent local file is still preserved as .local-<ts>.bak. For import
    # scope the entire tree was already copied to .conflict-backup-<ts>/ above,
    # so skip the redundant per-file backups. force=False keeps README intact.
    _pull_into_dir(base_url, token, shifu_bid, course_dir,
                   backup=(scope != "import"), force=False)

    cm = conflict_meta or {}
    who = _mask_phone((cm.get("updated_user") or {}).get("phone")) \
        or (cm.get("updated_user") or {}).get("user_bid") or "another editor"
    when = fmt_time(cm.get("updated_at")) if cm.get("updated_at") else ""
    print("", file=sys.stderr)
    print(f"⚠ Conflict: this course was changed on the server by {who}"
          + (f" at {when}" if when else "") + ".", file=sys.stderr)
    print(f"  Cloud is now authoritative and has been pulled into {course_dir}.",
          file=sys.stderr)
    if backup_location:
        print(f"  Your un-pushed change was saved to: {backup_location}",
              file=sys.stderr)
    print("  Re-apply your edit on the freshly pulled baseline and run the "
          "command again — repeat until it succeeds (exit 0). This is a retry, "
          "not a failure; never force the old content back.", file=sys.stderr)


# ── Create ─────────────────────────────────────────────────────────────────────
def cmd_create(args):
    """Create a new empty course."""
    base_url, token = resolve_auth(args)
    result = api(base_url, token, "put", "/shifus",
                 json={"name": args.name,
                       "description": args.description or ""})
    bid = result.get("bid") or result.get("shifu_bid")
    print(f"Created course: {bid}")
    print(f"  Name: {args.name}")
    _print_verification_urls(base_url, bid)


# ── Update Meta ────────────────────────────────────────────────────────────────
def _check_course_meta_conflict(base_url, token, shifu_bid, course_dir, manifest,
                                intended_meta):
    """Check course-level draft revision conflicts before a detail write."""
    if not (manifest and manifest.get("shifu_bid") == shifu_bid):
        return

    local_course_rev = (manifest.get("course") or {}).get("revision")
    cloud_meta = api_safe(base_url, token, "get",
                          f"/shifus/{shifu_bid}/draft-meta") or {}
    cloud_rev = cloud_meta.get("revision")
    if (cloud_rev is not None and local_course_rev is not None
            and cloud_rev > local_course_rev):
        _auto_pull_overwrite(base_url, token, shifu_bid, course_dir,
                             scope="meta", intended_meta=intended_meta,
                             conflict_meta=cloud_meta)
        sys.exit(EXIT_CONFLICT)


def _update_course_manifest_after_push(base_url, token, shifu_bid, course_dir,
                                       manifest, course_updates=None):
    """Re-read and record the new course-level revision after a detail write."""
    fresh = api_safe(base_url, token, "get", f"/shifus/{shifu_bid}/draft-meta")
    if not isinstance(fresh, dict) or fresh.get("revision") is None:
        # The POST already bumped the cloud revision; if we cannot read the new
        # value, writing the old revision back with a fresh last_push_at would
        # make the next edit see cloud > local and raise a false conflict.
        print("Warning: could not read the new course revision from the "
              "server; the sync manifest was left unchanged. Run "
              "`pull --course-dir <dir>` to resync.", file=sys.stderr)
        return

    # Explicit check (not setdefault): a hand-edited manifest with "course": null
    # would make setdefault return None and crash below.
    course = manifest.get("course")
    if not isinstance(course, dict):
        course = {}
        manifest["course"] = course

    course["revision"] = fresh.get("revision")
    for key, value in (course_updates or {}).items():
        if value is not None:
            course[key] = value
    if fresh.get("updated_at") is not None:
        course["updated_at"] = fresh.get("updated_at")
    fresh_user = (fresh.get("updated_user") or {}).get("user_bid")
    if fresh_user is not None:
        course["updated_user_bid"] = fresh_user
    manifest["last_push_at"] = _now_iso()
    _write_sync(course_dir, manifest)


def cmd_update_meta(args):
    """Update course metadata (name, description, system prompt, etc.).

    The detail POST has no server-side optimistic lock, so version protection is
    client-side: when --course-dir has a manifest, the course-level draft
    revision is compared against the recorded baseline before writing. Because
    the client cannot cheaply tell "I made the cloud change" from "someone else
    did", any cloud advance is treated conservatively as a conflict — and an
    over-pull is safe (local is always backed up first). On conflict it
    auto-pulls, records the intended change, and exits non-zero.
    """
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid
    course_dir = getattr(args, "course_dir", None)
    manifest = _load_sync(course_dir) if course_dir else None
    description = None
    if args.description is not None:
        description = _resolve_course_description(
            course_dir=course_dir,
            description=args.description,
        )
    elif (manifest and manifest.get("shifu_bid") == shifu_bid and course_dir
          and (Path(course_dir) / COURSE_DESCRIPTION_NAME).exists()):
        local_description = _resolve_course_description(course_dir=course_dir)
        manifest_description = ((manifest or {}).get("course") or {}).get(
            "description")
        if manifest_description is None:
            manifest_description = ""
        if local_description != manifest_description.strip():
            description = local_description

    intended = {"name": args.name, "description": description,
                "course_prompt_file": args.course_prompt_file}
    _check_course_meta_conflict(base_url, token, shifu_bid, course_dir, manifest,
                                intended)

    # Send ONLY the content fields the user is changing. The backend uses PATCH
    # semantics (an omitted field is left unchanged), so we deliberately do NOT
    # touch course attributes (model / price / TTS / Ask / keywords / avatar /
    # use_learner_language) here — the skill does not manage attributes by
    # default; they stay as set on the platform. To change an attribute, the user
    # asks explicitly (e.g. `set-access` for a lesson's permission).
    payload = {}
    if args.name is not None:
        payload["name"] = args.name
    if description is not None:
        payload["description"] = description
    if args.course_prompt_file:
        with open(args.course_prompt_file, "r", encoding="utf-8") as f:
            payload["system_prompt"] = f.read().strip()
    if not payload:
        print("Nothing to update "
              "(provide --name / --description / --course-prompt-file).")
        return

    api(base_url, token, "post", f"/shifus/{shifu_bid}/detail", json=payload)
    print(f"Updated metadata for {shifu_bid}")

    if course_dir and "description" in payload:
        _write_course_description(course_dir, payload["description"])

    # Re-read the course-level revision (the detail POST response does not carry
    # it) and record it as the new baseline so subsequent edits compare cleanly.
    if manifest and manifest.get("shifu_bid") == shifu_bid:
        _update_course_manifest_after_push(
            base_url, token, shifu_bid, course_dir, manifest,
            course_updates={
                "name": payload.get("name"),
                "description": payload.get("description"),
            })


# ── Set TTS ───────────────────────────────────────────────────────────────────
def cmd_set_tts(args):
    """Enable or disable course listening mode without changing other attributes."""
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid
    enabled = args.enabled == "true"
    course_dir = getattr(args, "course_dir", None)

    manifest = _load_sync(course_dir) if course_dir else None
    intended = {"tts_enabled": enabled}
    _check_course_meta_conflict(base_url, token, shifu_bid, course_dir, manifest,
                                intended)

    # Send only the TTS switch. Provider/model/voice/speed/pitch/emotion remain
    # whatever the platform currently stores.
    api(base_url, token, "post", f"/shifus/{shifu_bid}/detail",
        json={"tts_enabled": enabled})
    print(f"Set course {shifu_bid} TTS -> "
          f"{'enabled' if enabled else 'disabled'}")

    if manifest and manifest.get("shifu_bid") == shifu_bid:
        fresh_detail = api_safe(base_url, token, "get",
                                f"/shifus/{shifu_bid}/detail")
        if isinstance(fresh_detail, dict):
            _write_course_config(course_dir, _course_config_from_detail(fresh_detail))
        else:
            print("Warning: could not read updated course detail; "
                  f"{COURSE_CONFIG_NAME} was left unchanged. Run "
                  "`pull --course-dir <dir>` to resync.", file=sys.stderr)

        _update_course_manifest_after_push(base_url, token, shifu_bid,
                                           course_dir, manifest)


# ── Add Chapter ────────────────────────────────────────────────────────────────
def cmd_add_chapter(args):
    """Add a new top-level chapter to a course."""
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid

    result = api(base_url, token, "put", f"/shifus/{shifu_bid}/outlines",
                 json={"name": args.name})
    outline_bid = result.get("bid") or result.get("outline_item_bid")
    if not outline_bid:
        print(f"Error: chapter created but response did not include a BID", file=sys.stderr)
        print(f"  Response: {json.dumps(result, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)
    print(f"Created chapter: {outline_bid} ({args.name})")


# ── Add Lesson ─────────────────────────────────────────────────────────────────
def cmd_add_lesson(args):
    """Add a new lesson to a course."""
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid

    # Create outline
    outline_payload = {"name": args.name}
    if args.parent_bid:
        outline_payload["parent_bid"] = args.parent_bid

    result = api(base_url, token, "put", f"/shifus/{shifu_bid}/outlines",
                 json=outline_payload)
    outline_bid = result.get("bid") or result.get("outline_item_bid")
    parent_label = f" under {args.parent_bid}" if args.parent_bid else ""
    print(f"Created lesson: {outline_bid} ({args.name}){parent_label}")

    # Write Teaching Prompt if provided
    if args.teaching_prompt_file:
        with open(args.teaching_prompt_file, "r", encoding="utf-8") as f:
            content = f.read()
        api(base_url, token, "post",
            f"/shifus/{shifu_bid}/outlines/{outline_bid}/mdflow",
            json={"data": content})
        print(f"  Teaching Prompt saved ({len(content)} chars)")


# ── Update Lesson ──────────────────────────────────────────────────────────────
def cmd_update_lesson(args):
    """Update a lesson's MarkdownFlow with version-aware optimistic locking.

    When --course-dir points at a directory with a .shifu-sync.json manifest,
    base_revision is the *recorded baseline* for this outline (its revision at
    last pull/push) — so a concurrent edit by someone else is actually detected.
    Without a manifest the command falls back to the legacy behavior of taking
    the current cloud head as the baseline (degraded protection). On conflict it
    auto-pulls the cloud copy, backs up the attempted edit, and exits non-zero.
    """
    base_url, token = resolve_auth(args)
    shifu_bid = args.shifu_bid
    outline_bid = args.outline_bid
    course_dir = getattr(args, "course_dir", None)

    manifest = _load_sync(course_dir) if course_dir else None
    entry = None
    base_revision = None
    if manifest and manifest.get("shifu_bid") == shifu_bid:
        entry = _sync_lesson_by_bid(manifest, outline_bid)
        if entry:
            base_revision = entry.get("revision")
    if base_revision is None:
        # Legacy fallback: take the cloud head as baseline (no concurrency guard).
        current = api(base_url, token, "get",
                      f"/shifus/{shifu_bid}/outlines/{outline_bid}/mdflow")
        if isinstance(current, dict):
            base_revision = current.get("revision")
        if course_dir and not manifest:
            print("  note: no .shifu-sync.json — version protection degraded; "
                  "run `pull` first for full conflict detection.", file=sys.stderr)

    with open(args.teaching_prompt_file, "r", encoding="utf-8") as f:
        content = f.read()

    payload = {"data": content}
    if base_revision is not None:
        payload["base_revision"] = base_revision

    status, result = api_conflict_aware(
        base_url, token, "post",
        f"/shifus/{shifu_bid}/outlines/{outline_bid}/mdflow", json=payload)

    if status == "conflict":
        _auto_pull_overwrite(
            base_url, token, shifu_bid, course_dir, scope="lesson",
            outline_bid=outline_bid, attempted_content=content,
            local_file=(entry or {}).get("file"), conflict_meta=result)
        sys.exit(EXIT_CONFLICT)

    new_revision = result.get("new_revision")
    if manifest and entry is not None:
        _set_lesson_revision(manifest, outline_bid, new_revision,
                             content_sha256=_sha256_text(content))
        manifest["last_push_at"] = _now_iso()
        _write_sync(course_dir, manifest)
        # Keep the local lesson file in lockstep with what was just pushed, so a
        # subsequent `status` reports clean instead of "locally modified".
        if entry.get("file"):
            dest = safe_join_path(course_dir, entry["file"])
            if dest:
                Path(dest).write_text(content, encoding="utf-8")
    print(f"Updated lesson {outline_bid} ({len(content)} chars)")
    print(f"  Base revision: {base_revision} -> new revision: {new_revision}")


# ── Rename Lesson ──────────────────────────────────────────────────────────────
def cmd_rename_lesson(args):
    """Rename an existing lesson."""
    base_url, token = resolve_auth(args)
    api(base_url, token, "post",
        f"/shifus/{args.shifu_bid}/outlines/{args.outline_bid}",
        json={"name": args.name})
    print(f"Renamed lesson {args.outline_bid} to: {args.name}")


# ── Delete Lesson ──────────────────────────────────────────────────────────────
def cmd_delete_lesson(args):
    """Delete a lesson from a course."""
    base_url, token = resolve_auth(args)
    api(base_url, token, "delete",
        f"/shifus/{args.shifu_bid}/outlines/{args.outline_bid}")
    print(f"Deleted lesson {args.outline_bid}")


# ── Reorder ────────────────────────────────────────────────────────────────────
def cmd_reorder(args):
    """Reorder lessons in a course."""
    base_url, token = resolve_auth(args)
    bids = [b.strip() for b in args.order.split(",") if b.strip()]
    api(base_url, token, "patch",
        f"/shifus/{args.shifu_bid}/outlines/reorder",
        json={"order": bids})
    print(f"Reordered {len(bids)} lessons")


# ── Set Access (learning permission) ────────────────────────────────────────────
def _sync_structure_access(course_dir, outline_bid, access, hidden):
    """Best-effort: reflect one lesson's access/hidden into local structure.json,
    matched via the .shifu-sync.json outline_bid -> file mapping. No-op when the
    manifest / structure.json is missing."""
    manifest = _load_sync(course_dir)
    if not manifest:
        return
    entry = _sync_lesson_by_bid(manifest, outline_bid)
    if not entry or not entry.get("file"):
        return
    rel = entry["file"]
    fname = rel.split("/", 1)[1] if rel.startswith("lessons/") else rel
    sp = Path(course_dir) / "structure.json"
    if not sp.exists():
        return
    try:
        data = json.loads(sp.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    changed = False
    chapters = data.get("chapters")
    if isinstance(chapters, list):
        for ch in chapters:
            if not isinstance(ch, dict):
                continue
            lessons = ch.get("lessons")
            if not isinstance(lessons, list):
                continue
            for ls in lessons:
                if not isinstance(ls, dict):
                    continue
                if ls.get("file") == fname:
                    ls["access"] = access
                    if hidden is not None:
                        ls["hidden"] = hidden
                    changed = True
    if changed:
        sp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")


def cmd_set_access(args):
    """Set a lesson's learning-access type (guest/trial/normal) and optionally
    its visibility, without re-importing the whole course."""
    base_url, token = resolve_auth(args)
    shifu_bid, outline_bid = args.shifu_bid, args.outline_bid
    if args.access not in ACCESS_TYPES:
        print(f"Error: --access must be one of: {', '.join(ACCESS_TYPES)}")
        sys.exit(1)
    hidden = None
    if args.hidden is not None:
        hidden = args.hidden == "true"

    # Backend uses PATCH semantics, so send ONLY what we're changing — the
    # lesson's name / system prompt / etc. are preserved by omission.
    payload = {"type": args.access}
    if hidden is not None:
        payload["is_hidden"] = hidden
    api(base_url, token, "post",
        f"/shifus/{shifu_bid}/outlines/{outline_bid}", json=payload)

    label = {"guest": "无需登录 (guest)", "trial": "试看/需登录 (trial)",
             "normal": "需付费 (normal)"}[args.access]
    print(f"Set lesson {outline_bid} access -> {label}"
          + (f", hidden={hidden}" if hidden is not None else ""))

    if getattr(args, "course_dir", None):
        _sync_structure_access(args.course_dir, outline_bid, args.access, hidden)


# ── Import ─────────────────────────────────────────────────────────────────────
def _outline_create_payload(item, parent_bid=None):
    """Build the PUT /outlines payload for one outline_item.

    Only name (+ parent) — the skill does not push learning-access / visibility
    by default. `import` is for new courses / structural changes; a newly created
    outline gets the platform default and is then managed online (or via
    `set-access`). Content iteration on an existing course should use
    `update-lesson`, which never touches attributes.
    """
    payload = {"name": item["title"]}
    if parent_bid:
        payload["parent_bid"] = parent_bid
    return payload


def _import_flat(base_url, token, json_file, shifu_bid):
    """Import from flat JSON file (original shifu-api-import.py logic)."""
    with open(json_file, "r", encoding="utf-8") as f:
        import_data = json.load(f)

    shifu_info = import_data["shifu"]
    outline_items = import_data["outline_items"]

    # Create or reuse shifu
    if shifu_bid:
        print(f"Using existing shifu: {shifu_bid}")
    else:
        print(f"Creating new shifu: {shifu_info['title']}")
        result = api(base_url, token, "put", "/shifus",
                     json={"name": shifu_info["title"],
                           "description": shifu_info.get("description", "")})
        shifu_bid = result.get("bid") or result.get("shifu_bid")
        print(f"  Created shifu: {shifu_bid}")

    # Update shifu detail — send ONLY the content fields. The backend uses PATCH
    # semantics, so omitting the course attributes (model / price / TTS / Ask /
    # keywords / avatar / …) leaves them untouched: a re-import never resets them.
    # A brand-new course (import --new) gets platform defaults for the omitted
    # attributes. The skill does not push attributes by default.
    detail_payload = {
        "name": shifu_info["title"],
        "description": shifu_info.get("description", ""),
        "system_prompt": shifu_info.get("course_prompt", ""),
    }
    for attempt in range(1, 4):
        result = api_safe(base_url, token, "post", f"/shifus/{shifu_bid}/detail",
                          json=detail_payload)
        if result is not None:
            print("  Updated shifu detail")
            break
        if attempt < 3:
            print(f"  Warning: failed to update shifu detail (attempt {attempt}/3), retrying...")
            time.sleep(1)
        else:
            print("Error: failed to update shifu detail after 3 attempts")
            sys.exit(1)

    # Clean existing outlines (delete children first, then parents)
    tree = api_safe(base_url, token, "get", f"/shifus/{shifu_bid}/outlines")
    if tree and isinstance(tree, list):
        for item in tree:
            for child in item.get("children", []):
                if child.get("bid"):
                    result = api_safe(base_url, token, "delete",
                                      f"/shifus/{shifu_bid}/outlines/{child['bid']}")
                    if result is None:
                        print(f"Error: failed to delete child outline: {child['bid']}")
                        sys.exit(1)
            if item.get("bid"):
                result = api_safe(base_url, token, "delete",
                                  f"/shifus/{shifu_bid}/outlines/{item['bid']}")
                if result is None:
                    print(f"Error: failed to delete outline: {item.get('name', item['bid'])}")
                    sys.exit(1)
                print(f"  Deleted old outline: {item.get('name', item['bid'])}")

    # Separate parents (chapters) and children (lessons) for two-pass creation
    parents = []
    children = []
    for item in outline_items:
        if item.get("parent_bid"):
            children.append(item)
        else:
            parents.append(item)

    bid_map = {}  # old outline_item_bid -> new API bid
    created = []
    total = len(outline_items)
    count = 0

    # Segmentation: Create parent items (chapters)
    for item in parents:
        count += 1
        title = item["title"]
        content = item.get("content", "")
        old_bid = item.get("outline_item_bid", "")

        result = api(base_url, token, "put", f"/shifus/{shifu_bid}/outlines",
                     json=_outline_create_payload(item))
        new_bid = result.get("bid") or result.get("outline_item_bid")
        bid_map[old_bid] = new_bid
        print(f"  [{count}/{total}] Created: {title} ({new_bid})")

        if content:
            api(base_url, token, "post",
                f"/shifus/{shifu_bid}/outlines/{new_bid}/mdflow",
                json={"data": content})
            print(f"    MarkdownFlow saved ({len(content)} chars)")

        created.append({"bid": new_bid, "title": title})
        time.sleep(0.3)

    # Orchestration: Create child items (lessons) with mapped parent_bid
    for item in children:
        count += 1
        title = item["title"]
        content = item.get("content", "")
        old_parent = item["parent_bid"]
        new_parent = bid_map.get(old_parent, old_parent)

        result = api(base_url, token, "put", f"/shifus/{shifu_bid}/outlines",
                     json=_outline_create_payload(item, parent_bid=new_parent))
        new_bid = result.get("bid") or result.get("outline_item_bid")
        print(f"  [{count}/{total}] Created: {title} ({new_bid})")

        if content:
            api(base_url, token, "post",
                f"/shifus/{shifu_bid}/outlines/{new_bid}/mdflow",
                json={"data": content})
            print(f"    MarkdownFlow saved ({len(content)} chars)")

        created.append({"bid": new_bid, "title": title})
        time.sleep(0.3)

    print(f"\nDone! Shifu: {shifu_bid}")
    print(f"  Course: {shifu_info['title']}")
    print(f"  Chapters: {len(parents)}, Lessons: {len(children)}")
    _print_verification_urls(base_url, shifu_bid)
    return shifu_bid


def cmd_import(args):
    """Import a course from JSON file or course directory."""
    if args.new and args.shifu_bid:
        print("Error: omit <shifu_bid> when using --new")
        sys.exit(1)
    if not args.new and not args.shifu_bid:
        print("Error: provide <shifu_bid> or use --new")
        sys.exit(1)

    base_url, token = resolve_auth(args)
    shifu_bid = None if args.new else args.shifu_bid

    # Version preflight: when re-importing into an existing, version-tracked
    # course, refuse to clobber changes another editor pushed since the last
    # sync — auto-pull instead (the whole local tree is backed up first).
    if shifu_bid and args.course_dir:
        pre = _load_sync(args.course_dir)
        if pre and pre.get("shifu_bid") == shifu_bid:
            local_rev = (pre.get("course") or {}).get("revision")
            cloud_meta = api_safe(base_url, token, "get",
                                  f"/shifus/{shifu_bid}/draft-meta") or {}
            cloud_rev = cloud_meta.get("revision")
            if (cloud_rev is not None and local_rev is not None
                    and cloud_rev > local_rev):
                _auto_pull_overwrite(base_url, token, shifu_bid, args.course_dir,
                                     scope="import", conflict_meta=cloud_meta)
                sys.exit(EXIT_CONFLICT)

    result_bid = None
    if args.course_dir:
        # Build JSON first, then import
        json_file = _build_import_json(
            course_dir=args.course_dir,
            title=getattr(args, "title", None),
            description=getattr(args, "description", None),
            keywords=getattr(args, "keywords", None),
            chapter_name=getattr(args, "chapter_name", None),
        )
        result_bid = _import_flat(base_url, token, json_file, shifu_bid)
    elif args.json_file:
        result_bid = _import_flat(base_url, token, args.json_file, shifu_bid)
    else:
        print("Error: provide --json-file or --course-dir")
        sys.exit(1)

    # Re-seed the sync manifest from the freshly imported cloud state so future
    # edits are version-tracked. Phase 1 import is destructive (all outline bids
    # are regenerated), so a pull is the reliable way to capture them.
    if args.course_dir and result_bid:
        _pull_into_dir(base_url, token, result_bid, args.course_dir,
                       backup=False, force=False)
        print(f"  Sync manifest seeded: {_sync_path(args.course_dir)}")


# ── Build ──────────────────────────────────────────────────────────────────────
def _derive_lesson_title(filename):
    """Derive a readable lesson title from the lesson filename."""
    name = Path(filename).stem
    return name.replace("-", " ").title()


def _build_import_json(course_dir, title=None, description=None,
                       keywords=None, chapter_name=None, output_path=None):
    """Build import JSON from a local course directory. Returns the output file path."""
    lessons_dir = os.path.join(course_dir, "lessons")
    if not os.path.isdir(lessons_dir):
        print(f"Error: lessons directory not found: {lessons_dir}")
        sys.exit(1)

    # Read course-level prompt if exists
    course_prompt = ""
    prompt_path = os.path.join(course_dir, "course-prompt.md")
    if os.path.exists(prompt_path):
        with open(prompt_path, "r", encoding="utf-8") as f:
            course_prompt = f.read().strip()
        print(f"Loaded course prompt ({len(course_prompt)} chars)")

    # Scan lesson files
    lesson_files = sorted([
        f for f in os.listdir(lessons_dir)
        if f.startswith("lesson-") and f.endswith(".md")
    ])
    if not lesson_files:
        print(f"Error: no lesson-*.md files found in {lessons_dir}")
        sys.exit(1)

    shifu_bid = str(uuid.uuid4()).replace("-", "")

    # Determine title: explicit arg > README > directory name
    if not title:
        readme_path = os.path.join(course_dir, "README.md")
        if os.path.exists(readme_path):
            with open(readme_path, "r", encoding="utf-8") as f:
                first_line = f.readline().strip()
            if first_line.startswith("#"):
                title = first_line.lstrip("#").strip()
        if not title:
            title = Path(course_dir).name

    description = _resolve_course_description(
        course_dir=course_dir,
        description=description,
    )

    # Load chapter structure from structure.json if exists,
    # otherwise auto-create a single chapter wrapping all lessons
    structure_file = os.path.join(course_dir, "structure.json")
    if os.path.exists(structure_file):
        with open(structure_file, "r", encoding="utf-8") as f:
            chapter_defs = json.load(f).get("chapters", [])
    else:
        chapter_defs = None

    outline_items = []
    structure_chapters = []

    if chapter_defs:
        # Multi-chapter mode: use structure.json definitions
        for ch_idx, ch_def in enumerate(chapter_defs):
            ch_bid = str(uuid.uuid4()).replace("-", "")
            ch_title = ch_def["title"]

            # Chapter item (container, no MarkdownFlow content)
            outline_items.append({
                "outline_item_bid": ch_bid,
                "title": ch_title,
                "type": 401,
                "hidden": 0,
                "parent_bid": "",
                "position": str(ch_idx),
                "prerequisite_item_bids": "",
                "llm": "",
                "llm_temperature": 0,
                "course_prompt": "",
                "ask_enabled_status": 5101,
                "ask_llm": "",
                "ask_llm_temperature": 0.0,
                "ask_llm_system_prompt": "",
                "content": "",
            })

            lesson_children = []
            for ls_idx, ls_def in enumerate(ch_def.get("lessons", [])):
                ls_file = ls_def["file"]
                filepath = safe_join_path(lessons_dir, ls_file)
                if filepath is None:
                    continue
                if not os.path.exists(filepath):
                    print(f"Warning: file not found: {filepath}, skipping")
                    continue
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()

                item_bid = str(uuid.uuid4()).replace("-", "")
                ls_title = ls_def.get("title") or _derive_lesson_title(ls_file)

                outline_items.append({
                    "outline_item_bid": item_bid,
                    "title": ls_title,
                    "type": 401,
                    "hidden": 0,
                    "parent_bid": ch_bid,
                    "position": str(ls_idx),
                    "prerequisite_item_bids": "",
                    "llm": "",
                    "llm_temperature": 0,
                    "course_prompt": course_prompt,
                    "ask_enabled_status": 5101,
                    "ask_llm": "",
                    "ask_llm_temperature": 0.0,
                    "ask_llm_system_prompt": "",
                    "content": content,
                })

                lesson_children.append({
                    "bid": item_bid, "id": 0, "type": "outline",
                    "children": [], "child_count": 0,
                })

            structure_chapters.append({
                "bid": ch_bid, "id": 0, "type": "outline",
                "children": lesson_children,
                "child_count": len(lesson_children),
            })
    else:
        # Single-chapter mode: wrap all lessons under one chapter
        chapter_bid = str(uuid.uuid4()).replace("-", "")
        chapter_title = chapter_name or title

        # Chapter item (container, no MarkdownFlow content)
        outline_items.append({
            "outline_item_bid": chapter_bid,
            "title": chapter_title,
            "type": 401,
            "hidden": 0,
            "parent_bid": "",
            "position": "0",
            "prerequisite_item_bids": "",
            "llm": "",
            "llm_temperature": 0,
            "course_prompt": "",
            "ask_enabled_status": 5101,
            "ask_llm": "",
            "ask_llm_temperature": 0.0,
            "ask_llm_system_prompt": "",
            "content": "",
        })

        lesson_children = []
        for idx, filename in enumerate(lesson_files):
            filepath = safe_join_path(lessons_dir, filename)
            if filepath is None:
                continue
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()

            item_bid = str(uuid.uuid4()).replace("-", "")
            lesson_title = _derive_lesson_title(filename)

            outline_items.append({
                "outline_item_bid": item_bid,
                "title": lesson_title,
                "type": 401,
                "hidden": 0,
                "parent_bid": chapter_bid,
                "position": str(idx),
                "prerequisite_item_bids": "",
                "llm": "",
                "llm_temperature": 0,
                "course_prompt": course_prompt,
                "ask_enabled_status": 5101,
                "ask_llm": "",
                "ask_llm_temperature": 0.0,
                "ask_llm_system_prompt": "",
                "content": content,
            })

            lesson_children.append({
                "bid": item_bid, "id": 0, "type": "outline",
                "children": [], "child_count": 0,
            })

        structure_chapters.append({
            "bid": chapter_bid, "id": 0, "type": "outline",
            "children": lesson_children,
            "child_count": len(lesson_children),
        })

    import_data = {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "shifu": {
            "shifu_bid": shifu_bid,
            "title": title,
            "keywords": keywords or "",
            "description": description or "",
            "avatar_res_bid": "",
            "llm": "",
            "llm_temperature": 0,
            "course_prompt": course_prompt,
            "ask_enabled_status": 5101,
            "ask_llm": "",
            "ask_llm_temperature": 0.0,
            "ask_llm_system_prompt": "",
        },
        "outline_items": outline_items,
        "structure": {
            "bid": shifu_bid,
            "id": 0,
            "type": "shifu",
            "children": structure_chapters,
            "child_count": len(structure_chapters),
        },
    }

    # Output
    if not output_path:
        output_path = os.path.join(course_dir, "shifu-import.json")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(import_data, f, ensure_ascii=False, indent=2)

    chapters = [i for i in outline_items if not i.get("parent_bid")]
    lessons = [i for i in outline_items if i.get("parent_bid")]
    print(f"Generated {output_path}")
    print(f"  Course: {title}")
    print(f"  Chapters: {len(chapters)}, Lessons: {len(lessons)}")
    print(f"  Shifu BID: {shifu_bid}")
    return output_path


def cmd_build(args):
    """Build import JSON from local course directory (no network needed)."""
    _build_import_json(
        course_dir=args.course_dir,
        title=args.title,
        description=args.description,
        keywords=args.keywords,
        chapter_name=args.chapter_name,
        output_path=args.output,
    )


# ── Publish / Archive / Unarchive ──────────────────────────────────────────────
def cmd_publish(args):
    """Publish a course."""
    base_url, token = resolve_auth(args)
    api(base_url, token, "post", f"/shifus/{args.shifu_bid}/publish", json={})
    print(f"Published: {args.shifu_bid}")
    _print_verification_urls(base_url, args.shifu_bid, include_published=True)


def cmd_archive(args):
    """Archive a course."""
    base_url, token = resolve_auth(args)
    api(base_url, token, "post", f"/shifus/{args.shifu_bid}/archive", json={})
    print(f"Archived: {args.shifu_bid}")


def cmd_unarchive(args):
    """Unarchive a course."""
    base_url, token = resolve_auth(args)
    api(base_url, token, "post", f"/shifus/{args.shifu_bid}/unarchive", json={})
    print(f"Unarchived: {args.shifu_bid}")


def cmd_analytics_query(args):
    """Run a DSL query against the creator-analytics endpoint.

    Output is the full JSON response (success rows or business error code)
    printed to stdout. Exit code is 0 only when the API returns code == 0.
    """
    base_url, token = resolve_auth(args)

    if args.dsl_file:
        try:
            with open(args.dsl_file, "r", encoding="utf-8") as f:
                body = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(f"Error reading --dsl-file: {e}")
            sys.exit(1)
    else:
        try:
            body = json.loads(args.dsl)
        except json.JSONDecodeError as e:
            print(f"Error parsing --dsl JSON: {e}")
            sys.exit(1)

    if not isinstance(body, dict):
        print("Error: DSL body must be a JSON object")
        sys.exit(1)

    existing = body.get("shifu_bid")
    if existing and existing != args.shifu_bid:
        print(f"Error: shifu_bid in DSL body ({existing}) "
              f"does not match positional arg ({args.shifu_bid})")
        sys.exit(1)
    body["shifu_bid"] = args.shifu_bid

    transport_ok, payload = api_analytics(base_url, token, body)
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if not transport_ok or not isinstance(payload, dict) or payload.get("code") != 0:
        sys.exit(1)


def cmd_find_title(args):
    """Resolve a course-title keyword to the canonical current title(s).

    Three-step lookup per PDF §1 of the 2026-05-15 query handbook:
      1. List the caller's shifu_bids via /shifus.
      2. For each shifu_bid, fetch the current published title (Recipe 0b)
         and the current draft title (Recipe 0c).
      3. Match the keyword against both titles (case-insensitive, whitespace-
         normalized) and report grouped results: Published, Draft-only,
         No match.

    Historical / renamed titles never appear in this output by construction
    — Recipe 0b/0c only return the `deleted = 0` row.
    """

    base_url, token = resolve_auth(args)
    keyword = args.keyword or ""
    needle = keyword.replace(" ", "").lower()
    # Mirror the backend metadata-table `title like` floor (>= 2 non-wildcard
    # characters, see references/analytics/dsl.md). A 1-character keyword
    # would substring-match almost every title client-side and rarely help
    # the user; reject early with a clear message rather than fan out a
    # cascade of low-signal API calls.
    if len(needle) < 2:
        print(
            "Error: keyword must contain at least 2 non-whitespace characters "
            "(case-insensitive prefix / substring matching)"
        )
        sys.exit(1)

    result = api(base_url, token, "get", "/shifus")
    courses = result if isinstance(result, list) else (result or {}).get("items", [])
    if not courses:
        print("No courses found for this account.")
        return

    published_matches = []  # (shifu_bid, published_title)
    # draft_matches holds courses whose draft title matches the keyword
    # but whose published title (if any) does not. Each row carries the
    # current published title alongside so the user can see the rename
    # state at a glance ("currently published as: X" vs "draft only").
    draft_matches = []  # (shifu_bid, draft_title, published_title_or_None)

    def _matches(title):
        if not title:
            return False
        return needle in title.replace(" ", "").lower()

    with requests.Session() as session:
        for c in courses:
            bid = c.get("bid", c.get("shifu_bid", ""))
            if not bid:
                continue
            published = _fetch_shifu_title(
                base_url,
                token,
                bid,
                table_key="shifu_published_shifus",
                session=session,
            )
            if published is not None and _matches(published):
                published_matches.append((bid, published))
                continue
            # Either no published row, or the published title does not match.
            # Always check the draft — a course whose draft has been renamed
            # but not yet republished is exactly the case `find-title` exists
            # to surface. (Previous logic checked draft only when published
            # was None, which silently dropped renamed-but-still-published
            # courses; flagged in PR #48 AI review.)
            draft = _fetch_shifu_title(
                base_url,
                token,
                bid,
                table_key="shifu_draft_shifus",
                session=session,
            )
            if draft is not None and _matches(draft):
                draft_matches.append((bid, draft, published))

    if published_matches:
        print(f"Published (current live title matches '{keyword}'):")
        for bid, title in published_matches:
            print(f"  {bid}  {title}")
    if draft_matches:
        print(f"\nDraft (matches '{keyword}'; not yet republished):")
        for bid, draft, published in draft_matches:
            if published is None:
                print(f"  {bid}  {draft}  (draft only — not yet published)")
            else:
                print(
                    f'  {bid}  {draft}  (currently published as: "{published}")'
                )
    if not published_matches and not draft_matches:
        print(f"No courses you own currently have a title matching '{keyword}'.")
        print("If the user is sure of the name, they may be remembering a "
              "historical title — check `shifu-cli.py list` for current titles.")


# ── Credit Detail ──────────────────────────────────────────────────────────────
def _parse_int_list_arg(raw, flag_name):
    """Parse a comma-separated integer list argument.

    Shared by ``--scene`` and ``--usage-type`` (flagged on PR #50 review
    as duplicated logic). Reports both the parse-failure and the empty-
    result cases on stderr and exits 1, so the CLI never sends an empty
    list to the backend (which would reject it as ``11002 invalidDsl``)
    and never silently drops a malformed value.
    """

    try:
        parsed = [int(item) for item in raw.split(",") if item.strip()]
    except ValueError:
        print(
            f"Error: {flag_name} must be a comma-separated list of integers",
            file=sys.stderr,
        )
        sys.exit(1)
    if not parsed:
        print(
            f"Error: {flag_name} must contain at least one integer",
            file=sys.stderr,
        )
        sys.exit(1)
    return parsed


def cmd_credit_detail(args):
    """Fetch server-side joined credit consumption detail for one shifu.

    Calls POST /api/creator-analytics/credit-detail, which joins
    bill_usage x credit_ledger_entries on (source_bid = usage_bid AND
    source_type = USAGE). Returns a per-row payload alongside a summary
    block (total records, total credits, distinct users, distinct progress
    records, wallet creator bid, time range).

    Use this whenever the user asks about credit consumption — the DSL
    bill_daily_usage_metrics table is empty in production until the daily
    aggregation cron is enabled.
    """

    base_url, token = resolve_auth(args)
    body = {"shifu_bid": args.shifu_bid}

    # Date range — parse and validate locally so a malformed --start /
    # --end does not round-trip to the backend as 11002 invalidDsl
    # (PR #50 review). Same stderr + exit-1 style as the --scene /
    # --usage-type guards below.
    start_d = None
    end_d = None
    if args.start:
        try:
            start_d = datetime.fromisoformat(args.start).date()
        except ValueError:
            print(
                "Error: --start must be an ISO date (YYYY-MM-DD)",
                file=sys.stderr,
            )
            sys.exit(1)
        body["start_date"] = args.start
    if args.end:
        try:
            end_d = datetime.fromisoformat(args.end).date()
        except ValueError:
            print(
                "Error: --end must be an ISO date (YYYY-MM-DD)",
                file=sys.stderr,
            )
            sys.exit(1)
        body["end_date"] = args.end
    if start_d and end_d and end_d < start_d:
        print("Error: --end must be on or after --start", file=sys.stderr)
        sys.exit(1)

    if args.scene:
        body["usage_scene"] = _parse_int_list_arg(args.scene, "--scene")
    if args.usage_type:
        body["usage_type"] = _parse_int_list_arg(args.usage_type, "--usage-type")

    # --limit / --offset bounds match the backend's
    # ANALYTICS_QUERY_LIMIT_MAX (1000) and offset >= 0 contract; check
    # locally so an obvious typo reports a clean error instead of an
    # 11007 invalidLimit round-trip (PR #50 review).
    if args.limit is not None:
        if args.limit < 1 or args.limit > 1000:
            print("Error: --limit must be in [1, 1000]", file=sys.stderr)
            sys.exit(1)
        body["limit"] = args.limit
    if args.offset is not None:
        if args.offset < 0:
            print("Error: --offset must be >= 0", file=sys.stderr)
            sys.exit(1)
        body["offset"] = args.offset

    ok, payload = api_credit_detail(base_url, token, body)
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if not ok or not isinstance(payload, dict) or payload.get("code") != 0:
        sys.exit(1)


# ── Upload Image ───────────────────────────────────────────────────────────────
def _load_manifest(manifest_path):
    if not manifest_path.exists():
        return {"images": []}
    try:
        with manifest_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"images": []}
    if not isinstance(data, dict) or not isinstance(data.get("images"), list):
        return {"images": []}
    return data


def _write_manifest(manifest_path, manifest):
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = manifest_path.with_suffix(manifest_path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp.replace(manifest_path)


def _update_manifest(course_dir, entry):
    """Upsert an image entry by 'local' (file path) or 'source_url' (URL upload)."""
    manifest_path = Path(course_dir) / "assets" / "image-manifest.json"
    manifest = _load_manifest(manifest_path)

    key_field = "local" if entry.get("local") else "source_url"
    key_value = entry[key_field]
    existing_idx = None
    for i, item in enumerate(manifest["images"]):
        if item.get(key_field) == key_value:
            existing_idx = i
            break
    if existing_idx is None:
        manifest["images"].append(entry)
    else:
        manifest["images"][existing_idx] = entry

    _write_manifest(manifest_path, manifest)
    print(f"info: manifest updated at {manifest_path}", file=sys.stderr)


def cmd_upload_image(args):
    """Upload a local image (with preprocessing) or a remote URL to ai-shifu OSS.

    Outputs ONLY the resulting URL to stdout — designed to be captured into the
    Teaching Prompt by an LLM or a shell pipeline. Diagnostic messages (manifest
    writes, etc.) go to stderr.
    """
    base_url, token = resolve_auth(args)

    # --file and --url are enforced as a required mutually exclusive group by
    # the argparse subparser, so we don't need to revalidate that here.
    course_dir = Path(args.course_dir).resolve() if args.course_dir else None
    alt = args.alt or ""

    if args.file:
        src_path = Path(args.file).resolve()
        if args.no_process:
            if not src_path.is_file():
                print(f"Error: file not found: {src_path}", file=sys.stderr)
                sys.exit(1)
            file_bytes = src_path.read_bytes()
            ext = src_path.suffix.lower() or ".jpg"
            mime_guess = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
            }.get(ext, "application/octet-stream")
            filename = src_path.name
            mime = mime_guess
            original_bytes = len(file_bytes)
        else:
            from image_utils import prepare_image  # local import keeps Pillow optional
            try:
                prepared = prepare_image(src_path)
            except ValueError as e:
                print(f"Error: {e}", file=sys.stderr)
                sys.exit(1)
            file_bytes = prepared.data
            filename = prepared.filename
            mime = prepared.mime
            original_bytes = prepared.original_bytes

        remote_url = api_upload(base_url, token, filename, file_bytes, mime)
        print(remote_url)

        if course_dir is not None:
            try:
                local_rel = str(src_path.relative_to(course_dir))
            except ValueError:
                local_rel = src_path.name
                print(
                    f"warning: {src_path} is outside --course-dir; "
                    f"recording only the filename ({local_rel}) in manifest "
                    "(cross-machine dedup may be imperfect)",
                    file=sys.stderr,
                )
            _update_manifest(course_dir, {
                "local": local_rel,
                "remote": remote_url,
                "alt": alt,
                "uploaded_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                "bytes": len(file_bytes),
                "original_bytes": original_bytes,
                "mime": mime,
                "filename": filename,
            })
        return

    # URL upload path — backend downloads, validates Content-Type, re-hosts.
    remote_url = api(base_url, token, "post", "/url-upfile", json={"url": args.url})
    print(remote_url)

    if course_dir is not None:
        _update_manifest(course_dir, {
            "source_url": args.url,
            "remote": remote_url,
            "alt": alt,
            "uploaded_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        })


# ── CLI Entry Point ────────────────────────────────────────────────────────────
def build_parser():
    """Build and return the argument parser with all subcommands."""
    # Shared parent parser for --token on every subcommand
    parent_parser = argparse.ArgumentParser(add_help=False)
    parent_parser.add_argument("--token", default=None,
                               help="JWT token (or SHIFU_TOKEN in .env)")

    parser = argparse.ArgumentParser(
        prog="shifu-cli",
        description="AI-Shifu Course CLI - Unified tool for course CRUD operations",
    )

    sub = parser.add_subparsers(dest="command", help="Available commands")

    # ── login ──
    p = sub.add_parser("login", parents=[parent_parser],
                       help="SMS login and save token")
    p.add_argument("--phone", required=True, help="Phone number for SMS login")
    p.add_argument("--sms-code", default=None,
                   help="4-digit SMS verification code")

    # ── verify ──
    sub.add_parser("verify", parents=[parent_parser],
                   help="Check whether the stored token is still valid "
                        "(exit 0 = valid, 1 = expired, 2 = unknown)")

    # ── list ──
    sub.add_parser("list", parents=[parent_parser], help="List all courses")

    # ── show ──
    p = sub.add_parser("show", parents=[parent_parser],
                       help="Show course detail or a lesson's Teaching Prompt")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("outline_bid", nargs="?", default=None,
                   help="Outline BID (omit to show tree)")

    # ── pull ──
    p = sub.add_parser("pull", parents=[parent_parser],
                       help="Pull a course from the platform into a local "
                            "course directory and write .shifu-sync.json")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--course-dir", required=True,
                   help="Local course directory to write into")
    p.add_argument("--force", action="store_true",
                   help="Overwrite local files without backing up divergent edits")

    # ── status ──
    p = sub.add_parser("status", parents=[parent_parser],
                       help="Compare local .shifu-sync.json against cloud revisions")
    p.add_argument("--course-dir", required=True,
                   help="Local course directory containing .shifu-sync.json")
    p.add_argument("--exit-code", action="store_true",
                   help="Exit non-zero when local and cloud have diverged")

    # ── history ──
    p = sub.add_parser("history", parents=[parent_parser],
                       help="Show Teaching Prompt revision history")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("outline_bid", help="Outline BID")

    # ── export ──
    p = sub.add_parser("export", parents=[parent_parser],
                       help="Export course to JSON")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("-o", "--output", default=None, help="Output file (stdout if omitted)")

    # ── create ──
    p = sub.add_parser("create", parents=[parent_parser],
                       help="Create a new empty course")
    p.add_argument("--name", required=True, help="Course name")
    p.add_argument("--description", default=None, help="Course description")

    # ── update-meta ──
    p = sub.add_parser("update-meta", parents=[parent_parser],
                       help="Update course metadata")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--name", default=None, help="New course name")
    p.add_argument("--description", default=None, help="New description")
    p.add_argument("--course-prompt-file", default=None,
                   help="File containing course-level prompt")
    p.add_argument("--course-dir", default=None,
                   help="Course directory with .shifu-sync.json (enables version "
                        "conflict protection)")

    # ── add-chapter ──
    p = sub.add_parser("add-chapter", parents=[parent_parser],
                       help="Add a new top-level chapter")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--name", required=True, help="Chapter name")

    # ── add-lesson ──
    p = sub.add_parser("add-lesson", parents=[parent_parser],
                       help="Add a new lesson under a chapter")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--name", required=True, help="Lesson name")
    p.add_argument("--teaching-prompt-file", default=None,
                   help="Teaching Prompt file (MarkdownFlow format)")
    p.add_argument("--parent-bid", required=True,
                   help="Parent chapter BID (use add-chapter to create one first)")

    # ── update-lesson ──
    p = sub.add_parser("update-lesson", parents=[parent_parser],
                       help="Update a lesson's Teaching Prompt")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("outline_bid", help="Outline BID")
    p.add_argument("--teaching-prompt-file", required=True,
                   help="Teaching Prompt file (MarkdownFlow format)")
    p.add_argument("--course-dir", default=None,
                   help="Course directory with .shifu-sync.json (uses the recorded "
                        "revision as the edit baseline; auto-pulls on conflict)")

    # ── rename-lesson ──
    p = sub.add_parser("rename-lesson", parents=[parent_parser],
                       help="Rename a lesson")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("outline_bid", help="Outline BID")
    p.add_argument("--name", required=True, help="New lesson name")

    # ── set-access ──
    p = sub.add_parser("set-access", parents=[parent_parser],
                       help="Set a lesson's learning-access type "
                            "(guest=无需登录 / trial=试看 / normal=需付费)")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("outline_bid", help="Outline BID")
    p.add_argument("--access", required=True, choices=["guest", "trial", "normal"],
                   help="guest=无需登录, trial=试看(需登录), normal=需付费")
    p.add_argument("--hidden", choices=["true", "false"], default=None,
                   help="Optionally set visibility (default: keep current)")
    p.add_argument("--course-dir", default=None,
                   help="Also reflect the change into local structure.json")

    # ── set-tts ──
    p = sub.add_parser("set-tts", parents=[parent_parser],
                       help="Enable or disable course listening mode (TTS)")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--enabled", required=True, choices=["true", "false"],
                   help="true=enable listening mode, false=disable it")
    p.add_argument("--course-dir", default=None,
                   help=f"Also refresh local {COURSE_CONFIG_NAME} and sync manifest")

    # ── delete-lesson ──
    p = sub.add_parser("delete-lesson", parents=[parent_parser],
                       help="Delete a lesson")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("outline_bid", help="Outline BID")

    # ── reorder ──
    p = sub.add_parser("reorder", parents=[parent_parser],
                       help="Reorder lessons")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--order", required=True,
                   help="Comma-separated list of outline BIDs in desired order")

    # ── import ──
    p = sub.add_parser("import", parents=[parent_parser],
                       help="Import a course from JSON file or course directory")
    p.add_argument("shifu_bid", nargs="?", default=None,
                   help="Existing course BID (omit with --new to create)")
    p.add_argument("--new", action="store_true",
                   help="Create a new course instead of updating")
    p.add_argument("--json-file", default=None, help="Flat import JSON file")
    p.add_argument("--course-dir", default=None,
                   help="Course directory (builds JSON then imports)")
    p.add_argument("--title", default=None,
                   help="Course title (only with --course-dir)")
    p.add_argument("--description", default=None,
                   help="Course description (only with --course-dir)")
    p.add_argument("--keywords", default=None,
                   help="Keywords, comma-separated (only with --course-dir)")
    p.add_argument("--chapter-name", default=None,
                   help="Chapter name (only with --course-dir)")

    # ── build ──
    p = sub.add_parser("build", help="Build import JSON from local course directory")
    p.add_argument("--course-dir", required=True, help="Course directory path")
    p.add_argument("-o", "--output", default=None,
                   help="Output file (default: <course-dir>/shifu-import.json)")
    p.add_argument("--title", default=None, help="Course title")
    p.add_argument("--chapter-name", default=None,
                   help="Chapter name (default: same as course title)")
    p.add_argument("--description", default=None, help="Course description")
    p.add_argument("--keywords", default=None, help="Keywords (comma-separated)")

    # ── publish ──
    p = sub.add_parser("publish", parents=[parent_parser],
                       help="Publish a course")
    p.add_argument("shifu_bid", help="Course BID")

    # ── archive ──
    p = sub.add_parser("archive", parents=[parent_parser],
                       help="Archive a course")
    p.add_argument("shifu_bid", help="Course BID")

    # ── unarchive ──
    p = sub.add_parser("unarchive", parents=[parent_parser],
                       help="Unarchive a course")
    p.add_argument("shifu_bid", help="Course BID")

    # ── analytics-query ──
    p = sub.add_parser("analytics-query", parents=[parent_parser],
                       help="Run a DSL query against the creator-analytics endpoint")
    p.add_argument("shifu_bid", help="Course BID")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--dsl", help="DSL body as an inline JSON string")
    src.add_argument("--dsl-file", help="Path to a JSON file containing the DSL body")

    # ── find-title ──
    p = sub.add_parser("find-title", parents=[parent_parser],
                       help="Find courses by current title (published + draft)")
    p.add_argument("keyword",
                   help="Title keyword to search for (case-insensitive, "
                        "whitespace-normalized; matches current published and "
                        "draft titles only — never historical / renamed titles)")

    # ── upload-image ──
    p = sub.add_parser("upload-image", parents=[parent_parser],
                       help="Upload a local image (auto-preprocessed) or a remote URL to OSS")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--file", help="Local image path (any common format incl. heic)")
    src.add_argument("--url", help="Remote http(s) image URL; backend re-hosts it")
    p.add_argument("--course-dir", default=None,
                   help="Course directory to record upload in assets/image-manifest.json")
    p.add_argument("--alt", default=None,
                   help="Short description of what the image conveys (stored in manifest)")
    p.add_argument("--no-process", action="store_true",
                   help="Skip local preprocessing and upload bytes as-is (debug only)")

    # ── credit-detail ──
    p = sub.add_parser("credit-detail", parents=[parent_parser],
                       help="Fetch joined credit consumption detail for one shifu")
    p.add_argument("shifu_bid", help="Course BID")
    p.add_argument("--start", help="Inclusive ISO date lower bound, e.g. 2026-05-15")
    p.add_argument("--end", help="Inclusive ISO date upper bound, e.g. 2026-05-16")
    p.add_argument("--scene",
                   help="Comma-separated usage_scene codes, e.g. 1202,1203 "
                        "(1201 debug / 1202 preview / 1203 production)")
    p.add_argument("--usage-type", dest="usage_type",
                   help="Comma-separated usage_type codes, e.g. 1101,1102 "
                        "(1101 LLM / 1102 TTS)")
    p.add_argument("--limit", type=int, default=None,
                   help="Row count cap, 1..1000 (default 100 server-side)")
    p.add_argument("--offset", type=int, default=None,
                   help="Pagination offset (default 0)")

    return parser


def main():
    load_env()

    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "login": cmd_login,
        "verify": cmd_verify,
        "list": cmd_list,
        "show": cmd_show,
        "pull": cmd_pull,
        "status": cmd_status,
        "history": cmd_history,
        "export": cmd_export,
        "create": cmd_create,
        "update-meta": cmd_update_meta,
        "add-chapter": cmd_add_chapter,
        "add-lesson": cmd_add_lesson,
        "update-lesson": cmd_update_lesson,
        "rename-lesson": cmd_rename_lesson,
        "set-access": cmd_set_access,
        "set-tts": cmd_set_tts,
        "delete-lesson": cmd_delete_lesson,
        "reorder": cmd_reorder,
        "import": cmd_import,
        "build": cmd_build,
        "publish": cmd_publish,
        "archive": cmd_archive,
        "unarchive": cmd_unarchive,
        "analytics-query": cmd_analytics_query,
        "find-title": cmd_find_title,
        "credit-detail": cmd_credit_detail,
        "upload-image": cmd_upload_image,
    }

    handler = commands.get(args.command)
    if handler:
        handler(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
