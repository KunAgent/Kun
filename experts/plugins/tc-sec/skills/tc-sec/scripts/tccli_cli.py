#!/usr/bin/env python3
"""Wrapper around tccli that suppresses log output and blocks configure.

Action 访问控制：加载同目录 tccli_cli_config.json，按黑名单优先 → 白名单 → 默认拒绝 判别。
help 子命令始终放行。详见 _load_acl / _check_action。
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import base

DEFAULT_TIMEOUT = 120
HELP_TIMEOUT = 30

_ACL_PATH = base.script_path("tccli_cli_config.json")
_ACL_CACHE = {"mtime": -1, "data": None}


def _error_json(code, message):
    """Print a structured error to stdout (so callers can always parse JSON). Never exits."""
    print(json.dumps({"Error": {"Code": code, "Message": message}}, ensure_ascii=False))


def _load_acl():
    """加载 tccli_cli_config.json，按 mtime 缓存（配置变更后无需重启）。缺失/损坏时返回安全默认（全拒绝非白名单）。"""
    try:
        mtime = os.path.getmtime(_ACL_PATH)
    except OSError:
        return {"whitelist_regex": [], "whitelist_actions": [], "blacklist_regex": [], "blacklist_actions": []}
    if _ACL_CACHE["data"] is not None and _ACL_CACHE["mtime"] == mtime:
        return _ACL_CACHE["data"]
    try:
        with open(_ACL_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"whitelist_regex": [], "whitelist_actions": [], "blacklist_regex": [], "blacklist_actions": []}
    for k in ("whitelist_regex", "blacklist_regex"):
        if not isinstance(data.get(k), list):
            data[k] = []
    for k in ("whitelist_actions", "blacklist_actions"):
        v = data.get(k)
        data[k] = [str(x) for x in v] if isinstance(v, list) else []
    _ACL_CACHE["mtime"] = mtime
    _ACL_CACHE["data"] = data
    return data


def _check_action(action):
    """判别 Action 是否允许执行。返回 (allowed: bool, reason: str)。help 始终放行（调用方负责 bypass）。

    顺序：黑名单（正则 or 精确）优先拒绝 → 白名单（正则 or 精确）放行 → 默认拒绝。
    正则必须是完整表达式，直接 re.search 原样匹配（不隐式锚定；要锚定开头/全匹配须自带 ^ / $）。精确清单全等匹配。
    """
    if not action:
        return False, "empty action"
    acl = _load_acl()
    for pat in acl["blacklist_regex"]:
        if re.search(pat, action):
            return False, f"action matched blacklist regex: {pat}"
    if action in acl["blacklist_actions"]:
        return False, f"action in blacklist: {action}"
    for pat in acl["whitelist_regex"]:
        if re.search(pat, action):
            return True, f"action matched whitelist regex: {pat}"
    if action in acl["whitelist_actions"]:
        return True, f"action in whitelist: {action}"
    return False, f"action not in whitelist (default deny): {action}"


def _is_help(args):
    """识别 help 调用：tccli <product> help / <product> <Action> help --detail / 含 --help。help 始终放行。"""
    return "help" in args or "--help" in args


def _make_env(tmp_home):
    """Build an env with an isolated HOME pointing at tmp_home (copied .tccli config).

    OS 差异（HOME vs USERPROFILE）由 base.make_isolated_home_env 统一处理。
    """
    env = base.make_isolated_home_env(tmp_home)
    real_tccli_conf = os.path.join(base.real_home(), ".tccli")
    tmp_tccli = os.path.join(tmp_home, ".tccli")
    os.makedirs(os.path.join(tmp_tccli, "log"))
    if os.path.isdir(real_tccli_conf):
        for name in os.listdir(real_tccli_conf):
            if name == "log":
                continue
            src = os.path.join(real_tccli_conf, name)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(tmp_tccli, name))
    return env


def _run_one(args):
    """Run a single tccli invocation with an isolated temp HOME.

    Returns a dict: {"stdout":..., "stderr":..., "returncode":...}. Never exits.
    Caller is responsible for tmp_home cleanup.
    """
    tmp_home = tempfile.mkdtemp(prefix="tccli_")
    env = _make_env(tmp_home)
    is_help = "--help" in args or "help" in args
    timeout = HELP_TIMEOUT if is_help else DEFAULT_TIMEOUT
    try:
        result = subprocess.run(["tccli"] + args, env=env, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp_home, ignore_errors=True)
        return {"stdout": "", "stderr": f"tccli command timed out after {timeout}s", "returncode": -1}
    except OSError as e:
        shutil.rmtree(tmp_home, ignore_errors=True)
        return {"stdout": "", "stderr": f"Failed to execute tccli: {e}", "returncode": -1}
    shutil.rmtree(tmp_home, ignore_errors=True)
    stdout = result.stdout.decode("utf-8", errors="replace") if isinstance(result.stdout, bytes) else (result.stdout or "")
    stderr = result.stderr.decode("utf-8", errors="replace") if isinstance(result.stderr, bytes) else (result.stderr or "")
    return {"stdout": stdout, "stderr": stderr, "returncode": result.returncode}


def _clean_stdout(stdout):
    """Extract clean JSON from stdout if possible, else return raw stdout."""
    cleaned = _extract_json(stdout)
    return cleaned if cleaned is not None else stdout


def _batch(cmds, workers=5):
    """Run multiple tccli invocations concurrently, each with isolated HOME.

    cmds: list of arg-lists (each forwarded to tccli, e.g. ["cwp","DescribeGeneralStat","--output","json"]).
    Returns {f"{args[0]}.{args[1]}": <parsed JSON object, raw text, or error dict>}.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def run(args):
        if not args:
            return "error", {"Error": {"Code": "MissingArguments", "Message": "empty command"}}
        key = f"{args[0]}.{args[1]}" if len(args) > 1 else args[0]
        if args[0] == "configure":
            return key, {"Error": {"Code": "Forbidden", "Message": "'tccli configure' is not allowed."}}
        # Action 访问控制：help 始终放行，其余按白/黑名单判别
        action = args[1] if len(args) > 1 else ""
        if not _is_help(args):
            allowed, reason = _check_action(action)
            if not allowed:
                return key, {"Error": {"Code": "ActionDenied", "Message": reason}}
        r = _run_one(args)
        stdout = r["stdout"]
        cleaned = _extract_json(stdout)
        if cleaned is not None:
            try:
                return key, json.loads(cleaned)
            except (json.JSONDecodeError, ValueError):
                return key, cleaned
        if r["returncode"] != 0:
            err = r["stderr"].strip() or stdout.strip() or "Unknown error"
            return key, {"Error": {"Code": "TccliError", "Message": f"code {r['returncode']}: {err}"}}
        return key, stdout

    res = {}
    with ThreadPoolExecutor(max_workers=min(workers, len(cmds))) as ex:
        futures = [ex.submit(run, c) for c in cmds]
        for f in as_completed(futures):
            try:
                k, v = f.result()
            except Exception as e:
                k, v = "error", {"Error": {"Code": "BatchError", "Message": str(e)}}
            res[k] = v
    return res


def main():
    args = sys.argv[1:]

    if not args:
        _error_json("MissingArguments", "No arguments provided. Usage: tccli_cli.py <product> <Action> [options] | batch '<json>'")
        return

    if args[0] == "configure":
        _error_json("Forbidden", "'tccli configure' is not allowed through this wrapper.")
        return

    if args[0] == "batch":
        if len(args) < 2:
            _error_json("MissingArguments", "batch requires a JSON array of command arg-lists")
            return
        try:
            cmds = json.loads(args[1])
        except json.JSONDecodeError as e:
            _error_json("InvalidJSON", f"failed to parse batch commands: {e}")
            return
        if not isinstance(cmds, list) or not cmds:
            _error_json("InvalidArguments", "batch input must be a non-empty JSON array")
            return
        if base.tccli() is None:
            _error_json("NotInstalled", "tccli is not installed. Please install it with: pip install tccli")
            return
        print(json.dumps(_batch(cmds), ensure_ascii=False, indent=2))
        return

    if base.tccli() is None:
        _error_json("NotInstalled", "tccli is not installed. Please install it with: pip install tccli")
        return

    # Action 访问控制：help 始终放行，其余按白/黑名单判别
    if not _is_help(args):
        action = args[1] if len(args) > 1 else ""
        allowed, reason = _check_action(action)
        if not allowed:
            _error_json("ActionDenied", reason)
            return

    r = _run_one(args)
    stdout, stderr, returncode = r["stdout"], r["stderr"], r["returncode"]

    if returncode != 0:
        err_msg = stderr.strip() or stdout.strip() or "Unknown error"
        if _is_json(stdout):
            print(stdout, end="")
        else:
            _error_json("TccliError", f"tccli exited with code {returncode}: {err_msg}")
        return

    output = _clean_stdout(stdout)
    if _is_help(args):
        extra = _load_capi_note(args)
        if extra:
            print(output + extra, end="")
            return
    print(output, end="")


def _load_capi_note(args):
    """若 references/capi/{product}.{Action}.md 存在，返回追加段落，否则返回空串。"""
    try:
        product = args[0] if args else ""
        action = next((a for a in args[1:] if a and not a.startswith("-") and a != "help"), "")
        if not product or not action:
            return ""
        capi_dir = os.path.join(base.plugin_root(), "skills", "tc-sec", "references", "capi")
        path = os.path.join(capi_dir, f"{product}.{action}.md")
        if not os.path.isfile(path):
            return ""
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        return f"\n\n--- Field notes from references/capi/{product}.{action}.md ---\n{content}\n"
    except Exception:
        return ""


def _is_json(text):
    """Check if text is valid JSON."""
    text = text.strip()
    if not text:
        return False
    try:
        json.loads(text)
        return True
    except (json.JSONDecodeError, ValueError):
        return False


def _extract_json(text):
    """Extract JSON from output that may have non-JSON prefix/suffix lines."""
    text = text.strip()
    if not text:
        return None

    if text.startswith(("{", "[")):
        if _is_json(text):
            return text
        # JSON starts at beginning but has trailing garbage — find the end
        trimmed = _trim_trailing_garbage(text)
        if trimmed:
            return trimmed

    for start_char in ("{", "["):
        idx = text.find(start_char)
        if idx > 0:
            candidate = text[idx:]
            if _is_json(candidate):
                return candidate
            trimmed = _trim_trailing_garbage(candidate)
            if trimmed:
                return trimmed

    for i, line in enumerate(text.splitlines()):
        stripped = line.strip()
        if stripped.startswith(("{", "[")):
            candidate = "\n".join(text.splitlines()[i:])
            if _is_json(candidate):
                return candidate
            trimmed = _trim_trailing_garbage(candidate)
            if trimmed:
                return trimmed

    return None


def _trim_trailing_garbage(text):
    """Try to extract valid JSON from text that starts with { or [ but has trailing content."""
    # Find the matching closing bracket by scanning backwards
    if text.startswith("{"):
        close = "}"
    elif text.startswith("["):
        close = "]"
    else:
        return None

    # Search from the end backwards for the last matching close bracket
    idx = text.rfind(close)
    while idx > 0:
        candidate = text[:idx + 1]
        if _is_json(candidate):
            return candidate
        idx = text.rfind(close, 0, idx)

    return None


if __name__ == "__main__":
    main()
