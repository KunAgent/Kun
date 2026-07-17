#!/usr/bin/env python3
"""HTTP proxy for the MiZhen production chatWorkbuddy endpoint."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request

DEFAULT_URL = "https://medagent.woa.com/med-agent/chatWorkbuddy"
DEFAULT_TIMEOUT_SECONDS = 120
DEFAULT_BINDING_FILE = os.path.join(os.path.expanduser("~"), ".workbuddy", "med-agent-proxy", "binding.json")
BIND_CONFIRM_PATH = "workbuddyBindConfirm"
BINDING_TYPE = "med_agent_workbuddy_bind"
BINDING_STATUS_BOUND = "bound"
BINDING_STATUS_OPTED_OUT = "opted_out"
WORKBUDDY_USER_ID_PREFIX = "wb_"
WORKBUDDY_USER_ID_TOKEN_BYTES = 24
OPT_OUT_KEYWORDS = {
    "不绑定",
    "不要绑定",
    "不想绑定",
    "不用绑定",
    "不需要绑定",
    "跳过绑定",
    "暂不绑定",
    "先不绑定",
    "暂时不绑定",
    "不绑",
    "skip",
    "nobind",
    "notbind",
    "dontbind",
    "donotbind",
}
UNBIND_KEYWORDS = {
    "解绑",
    "解除绑定",
    "取消绑定",
    "我要解绑",
    "想解绑",
    "帮我解绑",
    "请解绑",
    "unbind",
    "disconnect",
    "unlink",
}
KEYWORD_STRIP_RE = re.compile(r"""[\s\u00a0。．.!！?？,，、;；:：~～\-_/\\\"'`“”‘’（）()【】\[\]<>《》]+""")


def _read_query(args: argparse.Namespace) -> str:
    if args.query is not None:
        return args.query
    if args.query_file:
        with open(args.query_file, "r", encoding="utf-8") as f:
            return f.read()
    if not sys.stdin.isatty():
        return sys.stdin.read()
    return ""


def _validate_user_id(user_id: str) -> bool:
    if not 1 <= len(user_id) <= 256:
        return False
    return not any(ord(ch) < 32 or ch == "\x7f" for ch in user_id)


def _mask_user_id(user_id: str) -> str:
    if len(user_id) <= 8:
        return f"{user_id[:2]}***{user_id[-2:]}"
    return f"{user_id[:4]}***{user_id[-4:]}"


def _generate_user_id() -> str:
    user_id = f"{WORKBUDDY_USER_ID_PREFIX}{secrets.token_urlsafe(WORKBUDDY_USER_ID_TOKEN_BYTES)}"
    if not _validate_user_id(user_id):
        raise RuntimeError("failed to generate valid WorkBuddy userId")
    return user_id


def _normalize_keyword_input(query: str) -> str:
    return KEYWORD_STRIP_RE.sub("", (query or "").strip()).lower()


def _is_opt_out_query(query: str) -> bool:
    return _normalize_keyword_input(query) in OPT_OUT_KEYWORDS


def _is_unbind_query(query: str) -> bool:
    return _normalize_keyword_input(query) in UNBIND_KEYWORDS


def _extract_json_object(text: str) -> dict | None:
    stripped = text.strip()
    candidates = [stripped]

    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        candidates.append(fence.group(1).strip())

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1].strip())

    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _binding_user_id_from_query(query: str) -> str | None:
    value = _extract_json_object(query)
    if not value:
        return None

    binding_type = value.get("type")
    has_binding_prefix = "觅诊账号绑定" in query or "MED_AGENT_WORKBUDDY_BIND" in query
    if binding_type != BINDING_TYPE and not has_binding_prefix:
        return None

    raw_user_id = value.get("userId") or value.get("userid") or value.get("user_id")
    if isinstance(raw_user_id, int):
        raw_user_id = str(raw_user_id)
    if not isinstance(raw_user_id, str):
        return None

    user_id = raw_user_id.strip()
    if not _validate_user_id(user_id):
        raise ValueError("invalid userId in binding message")
    return user_id


def _bind_confirm_url_from_chat_url(chat_url: str) -> str:
    url = (chat_url or DEFAULT_URL).rstrip("/")
    if url.endswith("/chatWorkbuddy"):
        return f"{url[: -len('/chatWorkbuddy')]}/{BIND_CONFIRM_PATH}"
    return f"{url}/{BIND_CONFIRM_PATH}"


def _save_binding(binding_file: str, user_id: str, status: str = BINDING_STATUS_BOUND) -> None:
    directory = os.path.dirname(binding_file) or "."
    os.makedirs(directory, mode=0o700, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass

    data = {
        "type": BINDING_TYPE,
        "userId": user_id,
        "status": status,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if status == BINDING_STATUS_OPTED_OUT:
        data["optedOut"] = True
    tmp_path = f"{binding_file}.tmp.{os.getpid()}"
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, binding_file)
        try:
            os.chmod(binding_file, 0o600)
        except OSError:
            pass
    finally:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _read_bound_user_id(binding_file: str) -> str | None:
    try:
        with open(binding_file, "r", encoding="utf-8") as f:
            value = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(value, dict):
        return None
    raw_user_id = value.get("userId")
    if isinstance(raw_user_id, int):
        raw_user_id = str(raw_user_id)
    if not isinstance(raw_user_id, str):
        return None
    user_id = raw_user_id.strip()
    return user_id if _validate_user_id(user_id) else None


def _resolve_user_id(args: argparse.Namespace) -> str | None:
    for candidate in (args.user_id, os.environ.get("MED_AGENT_USER_ID"), _read_bound_user_id(args.binding_file)):
        if candidate is None:
            continue
        user_id = str(candidate).strip()
        if _validate_user_id(user_id):
            return user_id
    return None


def _remove_binding_if_matches(binding_file: str, user_id: str) -> None:
    if _read_bound_user_id(binding_file) != user_id:
        return
    try:
        os.unlink(binding_file)
    except FileNotFoundError:
        pass
    except OSError:
        pass


def _confirm_binding(bind_confirm_url: str, user_id: str, timeout: float) -> tuple[bool, str]:
    request = _build_request(bind_confirm_url, {"userid": user_id})
    try:
        with urllib.request.urlopen(request, timeout=min(max(timeout, 1.0), 15.0)) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        message = _json_text(body, "message", "errorMessage") or body.strip()
        return False, message or f"绑定确认失败（HTTP {exc.code}），请重新扫码复制新的绑定消息。"
    except urllib.error.URLError as exc:
        return False, f"绑定确认网络异常：{exc.reason}。请稍后重试。"
    except TimeoutError:
        return False, "绑定确认超时，请稍后重试。"

    try:
        value = json.loads(body.strip() or "{}")
    except json.JSONDecodeError:
        return False, "绑定确认接口返回异常，请稍后重试。"
    if not isinstance(value, dict):
        return False, "绑定确认接口返回异常，请稍后重试。"

    if value.get("ok") is True and value.get("bound") is True:
        return True, str(value.get("message") or "绑定已生效。")
    message = value.get("message") or value.get("errorMessage")
    if isinstance(message, str) and message.strip():
        return False, message.strip()
    return False, "当前绑定消息未生效或已失效，请重新扫码复制新的绑定消息。"


def _json_text(data: str, *keys: str) -> str | None:
    try:
        value = json.loads(data)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict):
        return None
    for key in keys:
        item = value.get(key)
        if isinstance(item, str):
            return item
    return None


def _iter_sse_events(body: str):
    event_name = "message"
    data_lines: list[str] = []

    def emit():
        nonlocal event_name, data_lines
        if not data_lines:
            event_name = "message"
            return None
        item = (event_name, "\n".join(data_lines))
        event_name = "message"
        data_lines = []
        return item

    for raw_line in body.splitlines():
        line = raw_line.rstrip("\r")
        if not line:
            item = emit()
            if item is not None:
                yield item
            continue
        if line.startswith(":"):
            continue
        field, sep, value = line.partition(":")
        if sep and value.startswith(" "):
            value = value[1:]
        if field == "event":
            event_name = value
        elif field == "data":
            data_lines.append(value)

    item = emit()
    if item is not None:
        yield item


def _chunk_content(event_name: str, data: str) -> str | None:
    if data == "[DONE]" or event_name not in {"chunk", "message"}:
        return None
    return _json_text(data, "content")


def _done_answer(event_name: str, data: str) -> str | None:
    if data == "[DONE]" or event_name != "done":
        return None
    return _json_text(data, "answer", "content", "message")


def _stream_sse_response(response) -> bool:
    event_name = "message"
    data_lines: list[str] = []
    emitted = False
    last_text = ""

    def emit() -> None:
        nonlocal event_name, data_lines, emitted, last_text
        if not data_lines:
            event_name = "message"
            return
        data = "\n".join(data_lines)
        chunk = _chunk_content(event_name, data)
        if chunk is not None:
            print(chunk, end="", flush=True)
            emitted = True
            last_text = chunk
        elif not emitted:
            answer = _done_answer(event_name, data)
            if answer is not None:
                print(answer, end="", flush=True)
                emitted = True
                last_text = answer
        event_name = "message"
        data_lines = []

    for raw_line in response:
        line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
        if not line:
            emit()
            continue
        if line.startswith(":"):
            continue
        field, sep, value = line.partition(":")
        if sep and value.startswith(" "):
            value = value[1:]
        if field == "event":
            event_name = value
        elif field == "data":
            data_lines.append(value)

    emit()
    if emitted and not last_text.endswith("\n"):
        print(flush=True)
    return emitted


def _format_response_body(body: str) -> str:
    stripped = body.strip()
    if not stripped:
        return ""

    direct_text = _json_text(stripped, "answer", "content")
    if direct_text is not None:
        return direct_text

    events = list(_iter_sse_events(body))
    if not events:
        return body

    chunks: list[str] = []
    done_answers: list[str] = []
    for event_name, data in events:
        chunk = _chunk_content(event_name, data)
        if chunk is not None:
            chunks.append(chunk)
            continue
        answer = _done_answer(event_name, data)
        if answer is not None:
            done_answers.append(answer)
    if chunks:
        return "".join(chunks)
    if done_answers:
        return done_answers[-1]

    return ""


def _build_request(url: str, payload_data: dict) -> urllib.request.Request:
    payload = json.dumps(payload_data, ensure_ascii=False).encode("utf-8")
    return urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "text/event-stream, application/json, text/plain, */*",
        },
    )


def _mark_opt_out_silently(url: str, user_id: str, timeout: float) -> None:
    if not user_id:
        return
    request = _build_request(url, {"query": "不绑定", "userid": user_id})
    try:
        with urllib.request.urlopen(request, timeout=min(max(timeout, 1.0), 5.0)) as response:
            response.read()
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Forward a raw user query to MiZhen chatWorkbuddy over HTTP.")
    parser.add_argument("--query", help="Raw user query to forward. If omitted, stdin is used.")
    parser.add_argument("--query-file", help="UTF-8 text file containing the raw user query.")
    parser.add_argument("--user-id", help="Bound MiZhen userId. Overrides local binding and MED_AGENT_USER_ID.")
    parser.add_argument("--binding-file", default=os.environ.get("MED_AGENT_BINDING_FILE", DEFAULT_BINDING_FILE), help="Local JSON file used to persist bound MiZhen userId.")
    parser.add_argument("--url", default=os.environ.get("MED_AGENT_CHAT_URL", DEFAULT_URL), help="chatWorkbuddy endpoint URL.")
    parser.add_argument("--bind-confirm-url", default=os.environ.get("MED_AGENT_BIND_CONFIRM_URL"), help="Backend endpoint used to confirm a WorkBuddy binding message before persisting it locally.")
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("MED_AGENT_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)), help="HTTP timeout in seconds.")
    args = parser.parse_args()
    if not args.bind_confirm_url:
        args.bind_confirm_url = _bind_confirm_url_from_chat_url(args.url)

    query = _read_query(args)
    if not query:
        print("med-agent-proxy error: empty query", file=sys.stderr)
        return 2

    binding_user_id = _binding_user_id_from_query(query)
    if binding_user_id is not None:
        confirmed, confirm_message = _confirm_binding(args.bind_confirm_url, binding_user_id, args.timeout)
        if not confirmed:
            _remove_binding_if_matches(args.binding_file, binding_user_id)
            print(confirm_message)
            return 1
        _save_binding(args.binding_file, binding_user_id, BINDING_STATUS_BOUND)
        print(f"觅诊账号绑定成功，后续会自动携带 userId={_mask_user_id(binding_user_id)} 调用 chatWorkbuddy。")
        return 0

    payload_data = {"query": query}
    user_id = _resolve_user_id(args)
    wants_opt_out = _is_opt_out_query(query)
    wants_unbind = _is_unbind_query(query)
    if wants_opt_out:
        user_id = _generate_user_id()
        _save_binding(args.binding_file, user_id, BINDING_STATUS_OPTED_OUT)
    if user_id is not None:
        payload_data["userid"] = user_id
    request = _build_request(args.url, payload_data)

    def persist_unbound_state() -> None:
        if wants_unbind and user_id is not None:
            _mark_opt_out_silently(args.url, user_id, args.timeout)
            new_user_id = _generate_user_id()
            _mark_opt_out_silently(args.url, new_user_id, args.timeout)
            _save_binding(args.binding_file, new_user_id, BINDING_STATUS_OPTED_OUT)

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            content_type = response.headers.get("Content-Type", "")
            if "text/event-stream" in content_type.lower():
                _stream_sse_response(response)
                persist_unbound_state()
                return 0

            body = response.read().decode("utf-8", errors="replace")
            output = _format_response_body(body)
            print(output, end="" if output.endswith("\n") else "\n")
            persist_unbound_state()
            return 0
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"med-agent-proxy http error: status={exc.code}", file=sys.stderr)
        if body:
            print(body, file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"med-agent-proxy network error: {exc.reason}", file=sys.stderr)
        return 1
    except TimeoutError:
        print("med-agent-proxy timeout error", file=sys.stderr)
        return 1
    except Exception as exc:  # Keep the skill deterministic and transparent for unexpected runtime failures.
        print(f"med-agent-proxy unexpected error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
