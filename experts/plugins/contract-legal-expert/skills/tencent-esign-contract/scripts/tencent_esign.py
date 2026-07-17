#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
腾讯电子签合同AI工具主入口
支持 Python 2.7+ / 3.x，零第三方依赖。

Usage:
    python3 scripts/tencent_esign.py <command> [args...]

Commands:
    auth-check                          检查 Token 是否已配置
    auth-save   <token>                 保存 Token
    auth-validate <token>               验证并保存 Token
    upload      <file...>               上传文件(支持多个)，返回 ResourceId
    call        <action> '<json>'       调用任意 API
    wait-draft  <task_id>               轮询起草任务直到完成
    wait-review <task_id>               轮询审查任务直到完成
    wait-compare <task_id>              轮询对比任务直到完成
    version                             显示版本信息
"""

import json
import os
import ssl
import sys
import time
import uuid

PY3 = sys.version_info[0] >= 3

if PY3:
    from http.client import HTTPSConnection, HTTPConnection
    from urllib.parse import urlparse
    from pathlib import Path
else:
    from httplib import HTTPSConnection, HTTPConnection
    from urlparse import urlparse

TOKEN_FILE = os.path.join(os.path.expanduser("~"), ".esign-token")


# ---------------------------------------------------------------------------
# Config (cached at module level)
# ---------------------------------------------------------------------------

_config_cache = None

_DEFAULT_CONFIG = {
    "baseUrl": "https://appgw.ess.tencent.cn/plugin/openapi/",
    "fileUploadUrl": "https://file.ess.tencent.cn/upload/",
    "version": "v1.0.0",
}

def load_config():
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    if PY3:
        script_dir = str(Path(__file__).parent.absolute())
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
    config_file = os.path.join(script_dir, "config.json")
    try:
        if os.path.exists(config_file):
            with open(config_file, "r") as f:
                cfg = json.load(f)
            merged = dict(_DEFAULT_CONFIG)
            merged.update(cfg)
            _config_cache = merged
        else:
            _config_cache = dict(_DEFAULT_CONFIG)
    except (IOError, ValueError, OSError) as e:
        sys.stderr.write("Warning: config.json 读取失败 (%s)，使用默认配置\n" % str(e))
        _config_cache = dict(_DEFAULT_CONFIG)
    return _config_cache


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def get_token():
    token = os.environ.get("ESIGN_TOKEN", "").strip()
    if token and token != "***************":
        return token
    try:
        if os.path.exists(TOKEN_FILE):
            with open(TOKEN_FILE, "r") as f:
                t = f.read().strip()
            if t and t != "***************":
                return t
    except (IOError, OSError) as e:
        sys.stderr.write("Warning: 读取 Token 文件失败: %s\n" % str(e))
    return ""


def save_token(token):
    try:
        token_dir = os.path.dirname(TOKEN_FILE)
        if token_dir and not os.path.exists(token_dir):
            os.makedirs(token_dir)
        with open(TOKEN_FILE, "w") as f:
            f.write(token.strip())
        try:
            os.chmod(TOKEN_FILE, 0o600)
        except Exception:
            pass
        return TOKEN_FILE
    except (IOError, OSError) as e:
        sys.stderr.write("Warning: 保存 Token 失败: %s\n" % str(e))
        return None


# ---------------------------------------------------------------------------
# HTTP (persistent connections with auto-reconnect)
# ---------------------------------------------------------------------------

_conn_pool = {}

MAX_RETRIES = 3


def _get_conn(url):
    """Get or create a persistent HTTPS/HTTP connection for the given URL's host."""
    parsed = urlparse(url)
    host = parsed.hostname
    port = parsed.port
    scheme = parsed.scheme

    if not host:
        raise ValueError("无效的 URL: %s" % url)

    key = "%s:%s:%s" % (scheme, host, port or (443 if scheme == "https" else 80))

    conn = _conn_pool.get(key)
    if conn is not None:
        return conn, parsed

    if scheme == "https":
        ctx = ssl.create_default_context()
        conn = HTTPSConnection(host, port or 443, timeout=120, context=ctx)
    else:
        conn = HTTPConnection(host, port or 80, timeout=120)

    _conn_pool[key] = conn
    return conn, parsed


def _drop_conn(url):
    """Remove a cached connection (call after unrecoverable errors)."""
    parsed = urlparse(url)
    key = "%s:%s:%s" % (parsed.scheme, parsed.hostname,
                        parsed.port or (443 if parsed.scheme == "https" else 80))
    conn = _conn_pool.pop(key, None)
    if conn:
        try:
            conn.close()
        except Exception:
            pass


def _parse_response(raw, status_code):
    """Parse HTTP response body, tolerating empty or non-JSON content."""
    if not raw or not raw.strip():
        if 200 <= status_code < 300:
            return {"Response": {}}
        return {"error": "HTTP %d: (空响应)" % status_code}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {"error": "HTTP %d: %s" % (status_code, raw[:500])}


def _request(url, method, body, headers, timeout=120):
    """Send an HTTP request with connection reuse. Retries up to MAX_RETRIES on transient failures."""
    if not url:
        return {"error": "URL 未配置，请检查 config.json 或环境变量。"}

    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            conn, parsed = _get_conn(url)
            path = parsed.path
            if parsed.query:
                path = path + "?" + parsed.query

            conn.timeout = timeout
            conn.request(method, path or "/", body=body, headers=headers)
            resp = conn.getresponse()
            raw = resp.read()
            if PY3:
                raw = raw.decode("utf-8")

            if resp.status in (502, 503, 504) and attempt < MAX_RETRIES - 1:
                sys.stderr.write("HTTP %d, 第 %d 次重试...\n" % (resp.status, attempt + 1))
                _drop_conn(url)
                time.sleep(min(2 ** attempt, 5))
                continue

            return _parse_response(raw, resp.status)

        except ValueError as e:
            return {"error": str(e)}
        except Exception as e:
            last_err = e
            _drop_conn(url)
            if attempt < MAX_RETRIES - 1:
                wait = min(2 ** attempt, 5)
                sys.stderr.write("连接异常 (%s), %ds 后第 %d 次重试...\n" % (str(e), wait, attempt + 1))
                time.sleep(wait)

    return {"error": "网络错误 (重试 %d 次后失败): %s" % (MAX_RETRIES, str(last_err))}


def call_api(action, params, token=None):
    if token is None:
        token = get_token()
    if not token:
        return {"error": "ESIGN_TOKEN 未配置。请先运行 auth-save 或设置环境变量 ESIGN_TOKEN。"}

    cfg = load_config()
    url = os.environ.get("ESIGN_BASE_URL", cfg.get("baseUrl", ""))

    if "Action" not in params:
        params["Action"] = action

    body = json.dumps(params, ensure_ascii=False)
    if PY3:
        body = body.encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "X-Tc-Version": "2020-11-11",
        "x-tc-action": action,
        "Authorization": token,
        "X-Skill-Version": cfg.get("version", "v1.0.0"),
    }

    return _request(url, "POST", body, headers, timeout=120)


# ---------------------------------------------------------------------------
# Auth commands
# ---------------------------------------------------------------------------

def cmd_auth_check():
    token = get_token()
    if token:
        out({"success": True, "message": "Token 已配置", "preview": token[:8] + "..."})
    else:
        out({"success": False, "message": "未找到 Token。请前往 https://qian.tencent.com/aiSkill 获取 SIGN-TOKEN。"})
        sys.exit(1)


def cmd_auth_save(token):
    path = save_token(token)
    if path:
        out({"success": True, "message": "Token 已保存至 " + path})
    else:
        out({"success": False, "message": "Token 保存失败，请检查文件权限。可通过环境变量 ESIGN_TOKEN 配置。"})
        sys.exit(1)


def cmd_auth_validate(token):
    result = call_api("DescribeContractReviewTask",
                      {"Action": "DescribeContractReviewTask", "TaskId": "__validate__"},
                      token=token)
    auth_fail = False
    server_error = False
    if "error" in result:
        err = str(result["error"]).lower()
        for kw in ("401", "403", "unauthorized", "authfailure", "invalidcredential", "forbidden"):
            if kw in err:
                auth_fail = True
                break
        for kw in ("500", "502", "503", "429", "timeout", "network error"):
            if kw in err:
                server_error = True
                break
    else:
        resp = result.get("Response", {})
        if "Error" in resp:
            code = resp["Error"].get("Code", "")
            auth_codes = ("AuthFailure", "UnauthorizedOperation", "InvalidCredential",
                          "AuthFailure.SignatureFailure", "AuthFailure.TokenFailure")
            if code in auth_codes:
                auth_fail = True
            elif code in ("InternalError", "RequestLimitExceeded"):
                server_error = True

    if auth_fail:
        out({"success": False, "message": "Token 验证失败。请前往 https://qian.tencent.com/aiSkill 重新获取 SIGN-TOKEN。"})
        sys.exit(1)
    elif server_error:
        out({"success": False, "message": "服务暂时不可用，无法验证 Token，请稍后重试。", "detail": result})
        sys.exit(1)
    else:
        path = save_token(token)
        if path:
            out({"success": True, "message": "已成功安装。Token 已验证并保存。", "path": path})
        else:
            out({"success": True, "message": "Token 验证通过，但保存失败。请通过环境变量 ESIGN_TOKEN 配置。"})


# ---------------------------------------------------------------------------
# Upload (multipart/form-data to dedicated file endpoint)
# ---------------------------------------------------------------------------

def build_multipart(file_paths, business_type="DOCUMENT"):
    boundary = "----EsignBoundary" + uuid.uuid4().hex
    parts = []

    # business_type field
    header = (
        "--%s\r\n"
        "Content-Disposition: form-data; name=\"business_type\"\r\n"
        "\r\n"
        "%s\r\n" % (boundary, business_type)
    )
    parts.append(header.encode("utf-8") if PY3 else header)

    # file fields
    for fp in file_paths:
        fname = os.path.basename(fp).replace('"', '\\"').replace('\n', '_')
        with open(fp, "rb") as f:
            data = f.read()
        header = (
            "--%s\r\n"
            "Content-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
            "Content-Type: application/octet-stream\r\n"
            "\r\n" % (boundary, fname)
        )
        if PY3:
            parts.append(header.encode("utf-8") + data + b"\r\n")
        else:
            parts.append(header + data + b"\r\n")

    footer = ("--%s--\r\n" % boundary)
    parts.append(footer.encode("utf-8") if PY3 else footer)

    body = b"".join(parts)
    content_type = "multipart/form-data; boundary=%s" % boundary
    return body, content_type


def upload_single(file_path, token, url):
    try:
        body, content_type = build_multipart([file_path])
    except (IOError, OSError) as e:
        return {"error": "读取文件失败 (%s): %s" % (file_path, str(e))}
    headers = {
        "Content-Type": content_type,
        "AccessToken": token,
    }
    return _request(url, "POST", body, headers, timeout=300)


def cmd_upload(file_paths):
    for fp in file_paths:
        if not os.path.exists(fp):
            out({"error": "文件不存在: " + fp})
            sys.exit(1)

    token = get_token()
    if not token:
        out({"error": "ESIGN_TOKEN 未配置。请先运行 auth-save 或设置环境变量 ESIGN_TOKEN。"})
        sys.exit(1)

    cfg = load_config()
    url = os.environ.get("ESIGN_FILE_URL", cfg.get("fileUploadUrl", ""))

    if len(file_paths) == 1:
        result = upload_single(file_paths[0], token, url)
        out(result)
        if "error" in result:
            sys.exit(1)
    else:
        results = []
        resource_ids = []
        for fp in file_paths:
            result = upload_single(fp, token, url)
            results.append(result)
            if "error" in result:
                out({"error": "上传 %s 失败" % fp, "detail": result})
                sys.exit(1)
            rid = result.get("Response", {}).get("ResourceId", "")
            resource_ids.append(rid)
            sys.stderr.write("已上传: %s -> %s\n" % (os.path.basename(fp), rid))
        out({"Response": {"ResourceIds": resource_ids, "TotalCount": len(resource_ids), "Details": results}})


# ---------------------------------------------------------------------------
# Generic call
# ---------------------------------------------------------------------------

def cmd_call(action, params_json):
    try:
        params = json.loads(params_json)
    except Exception as e:
        out({"error": "JSON 解析失败: %s" % str(e)})
        sys.exit(1)
    out(call_api(action, params))


# ---------------------------------------------------------------------------
# Polling helpers
# ---------------------------------------------------------------------------

MAX_POLL_ERRORS = 5

def poll(action, task_id, success_status, fail_status, max_wait=600):
    interval = 3
    elapsed = 0
    consecutive_errors = 0
    while elapsed < max_wait:
        result = call_api(action, {"Action": action, "TaskId": task_id})
        if "error" in result:
            consecutive_errors += 1
            sys.stderr.write("轮询出错 (%d/%d): %s\n" % (consecutive_errors, MAX_POLL_ERRORS, result["error"]))
            if consecutive_errors >= MAX_POLL_ERRORS:
                out({"error": "连续 %d 次轮询失败，放弃" % MAX_POLL_ERRORS, "lastError": result})
                sys.exit(1)
            time.sleep(interval)
            elapsed += interval
            continue
        consecutive_errors = 0
        resp = result.get("Response", {})
        if "Error" in resp:
            err_code = resp["Error"].get("Code", "")
            if err_code in ("RequestLimitExceeded", "InternalError"):
                sys.stderr.write("服务暂时异常 (%s)，等待后重试...\n" % err_code)
                time.sleep(interval)
                elapsed += interval
                continue
        status = resp.get("Status", -1)
        if status in (success_status if isinstance(success_status, (list, tuple)) else [success_status]):
            out(result)
            return
        if status in (fail_status if isinstance(fail_status, (list, tuple)) else [fail_status]):
            out(result)
            sys.exit(1)
        sys.stderr.write("Status=%s, elapsed=%ds, next poll in %ds ...\n" % (status, elapsed, interval))
        time.sleep(interval)
        elapsed += interval
        interval = min(int(interval + 2), 10)
    out({"error": "超时 (%d秒)" % max_wait})
    sys.exit(1)


def cmd_wait_draft(task_id):
    poll("DescribeDraftContractByPromptsTask", task_id, success_status=2, fail_status=3, max_wait=600)


def cmd_wait_review(task_id):
    poll("DescribeContractReviewTask", task_id, success_status=4, fail_status=5, max_wait=600)


def cmd_wait_compare(task_id):
    poll("DescribeContractComparisonTask", task_id, success_status=2, fail_status=3, max_wait=600)


# ---------------------------------------------------------------------------
# Output / main
# ---------------------------------------------------------------------------

def out(data):
    try:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    except (TypeError, ValueError):
        print(json.dumps({"error": "输出序列化失败", "raw": str(data)}, ensure_ascii=False, indent=2))


def print_usage():
    usage = """腾讯电子签合同AI工具

用法: python3 scripts/tencent_esign.py <command> [args...]

鉴权:
    auth-check                          检查 Token 是否已配置
    auth-save   <token>                 保存 Token（跳过验证）
    auth-validate <token>               验证并保存 Token

文件:
    upload <file...>                    上传文件(支持多个，逐个上传)，返回 ResourceId

API 调用:
    call <action> '<json_params>'       调用任意 API（action 为接口名）

轮询等待:
    wait-draft   <task_id>              等待起草任务完成（Status 2=成功 3=失败）
    wait-review  <task_id>              等待审查任务完成（Status 4=成功 5=失败）
    wait-compare <task_id>              等待对比任务完成（Status 2=成功 3=失败）

其他:
    version                             显示版本信息

调用示例:
    python3 scripts/tencent_esign.py auth-check
    python3 scripts/tencent_esign.py upload /path/to/contract.pdf /path/to/another.pdf
    python3 scripts/tencent_esign.py call CreateBatchContractReviewTask '{"ResourceIds":["yDxxx"],"PolicyType":0}'
    python3 scripts/tencent_esign.py wait-review yDxxxTaskId
"""
    print(usage)


def main():
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "version":
        cfg = load_config()
        out({"name": cfg.get("name", "tencent-esign-contract"), "version": cfg.get("version", "unknown")})
        sys.exit(0)
    elif cmd == "auth-check":
        cmd_auth_check()
    elif cmd == "auth-save":
        if len(sys.argv) < 3:
            out({"error": "缺少 token 参数"})
            sys.exit(1)
        cmd_auth_save(sys.argv[2])
    elif cmd == "auth-validate":
        if len(sys.argv) < 3:
            out({"error": "缺少 token 参数"})
            sys.exit(1)
        cmd_auth_validate(sys.argv[2])
    elif cmd == "upload":
        if len(sys.argv) < 3:
            out({"error": "缺少文件路径参数"})
            sys.exit(1)
        cmd_upload(sys.argv[2:])
    elif cmd == "call":
        if len(sys.argv) < 4:
            out({"error": "用法: call <action> '<json_params>'"})
            sys.exit(1)
        cmd_call(sys.argv[2], sys.argv[3])
    elif cmd == "wait-draft":
        if len(sys.argv) < 3:
            out({"error": "缺少 task_id"})
            sys.exit(1)
        cmd_wait_draft(sys.argv[2])
    elif cmd == "wait-review":
        if len(sys.argv) < 3:
            out({"error": "缺少 task_id"})
            sys.exit(1)
        cmd_wait_review(sys.argv[2])
    elif cmd == "wait-compare":
        if len(sys.argv) < 3:
            out({"error": "缺少 task_id"})
            sys.exit(1)
        cmd_wait_compare(sys.argv[2])
    else:
        out({"error": "未知命令: " + cmd})
        print_usage()
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.stderr.write("\n操作已取消\n")
        sys.exit(130)
    except Exception as e:
        out({"error": "未预期的异常: %s" % str(e)})
        sys.exit(1)
