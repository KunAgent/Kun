#!/usr/bin/env python3
"""
cos_upload.py - 本地文件上传到 COS，返回公网访问地址

用途：
  WorkBuddy 场景下，对话中携带本地文件（绝对路径）时，先把文件上传到 migraq
  专用 COS 桶，拿到裸 URL 后，再由 migraq_chat.py 把 URL 作为上下文转发给远端专家。

流程：
  Step 1: 调用 COS 临时密钥接口取 STS 临时密钥（走太湖 OAuth2 Bearer 直连网关）
          POST https://migraq-chat.mcp.it.woa.com/proxy/v2/cos/temp_credential
          Body: {"scene":"migraq","file_name":"<文件名>"}
          复用 tai-auth.sh 自动携带 Bearer Token（与 chat 共享同一登录态）

  Step 2: 用临时密钥（TmpSecretId/TmpSecretKey/SessionToken）按 COS 请求签名算法
          （q-sign-algorithm=sha1）对 PUT 请求签名，直传文件到 COS

  Step 3: 拼裸 URL（桶为公有读，无需签名参数）：
          https://<Bucket>.cos.<Region>.myqcloud.com/<Key>

输出：
  统一 JSON（stdout），供 agent 取 data.url 后追加到转发上下文。

Usage:
  python3 cos_upload.py /abs/path/to/google_scan_xxx.xlsx
  python3 cos_upload.py /abs/path/to/file.csv --scene migraq
  python3 cos_upload.py /abs/path/to/file.xlsx --token-url https://migraq-chat.mcp.it.woa.com/...

依赖：
  - tai-auth.sh（macOS/Linux）/ tai-auth.ps1（Windows），同目录
  - python3 标准库（hmac / hashlib / http.client / subprocess / argparse）
"""

import argparse
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
from http.client import HTTPSConnection
from urllib.parse import quote, urlparse

# ===== 配置 =====
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

IS_WINDOWS = sys.platform == "win32"
if IS_WINDOWS:
    TAI_AUTH_SCRIPT = os.path.join(SCRIPT_DIR, "tai-auth.ps1")
    TAI_AUTH_CMD = ["powershell", "-ExecutionPolicy", "Bypass", "-File", TAI_AUTH_SCRIPT]
else:
    TAI_AUTH_SCRIPT = os.path.join(SCRIPT_DIR, "tai-auth.sh")
    TAI_AUTH_CMD = [TAI_AUTH_SCRIPT]

# COS 临时密钥网关地址。
# 可用环境变量 MIGRAQ_TEMP_CREDENTIAL_URL 或 --token-url 覆盖。
DEFAULT_TEMP_CREDENTIAL_URL = os.environ.get(
    "MIGRAQ_TEMP_CREDENTIAL_URL",
    "https://migraq-chat.mcp.it.woa.com/proxy/v2/cos/temp_credential",
)

# 单请求简单上传上限提示阈值（超过仅警告，仍尝试上传）
LARGE_FILE_WARN_BYTES = 100 * 1024 * 1024


# ===== 日志（stderr，不干扰 stdout 结构化输出）=====
def log(msg):
    print(f"[cos-upload] {msg}", file=sys.stderr)


def log_error(msg):
    print(f"[cos-upload] \u2717 {msg}", file=sys.stderr)


def _print_json(obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def _fail(code, message, request_id=""):
    _print_json({
        "success": False,
        "action": "CosUpload",
        "error": {"code": code, "message": message},
        "requestId": request_id,
    })
    sys.exit(1)


# ===== Step 1: 获取 COS 临时密钥 =====
def get_temp_credential(token_url, scene, file_name):
    log("Step 1: 获取 COS 临时密钥 (temp_credential)...")
    log(f"  URL: {token_url}")

    if not os.path.isfile(TAI_AUTH_SCRIPT):
        script_name = "tai-auth.ps1" if IS_WINDOWS else "tai-auth.sh"
        _fail("ConfigError", f"{script_name} not found: {TAI_AUTH_SCRIPT}")
    if not IS_WINDOWS and not os.access(TAI_AUTH_SCRIPT, os.X_OK):
        os.chmod(TAI_AUTH_SCRIPT, 0o755)

    # 后端在 file_name 末尾追加 _date_random 作为 COS Key，
    # 若传完整文件名（如 test.xlsx），Key 会变成 test.xlsx_20260702_xxx，
    # 扩展名被破坏。这里传不带扩展名的 stem，Key 变成 test_20260702_xxx，
    # 然后在上传时把原始扩展名补回 Key 末尾（test_20260702_xxx.xlsx），
    # 让 COS 上的文件保留正确扩展名，远端可从 URL 后缀判断文件类型。
    stem, ext = os.path.splitext(file_name)
    request_file_name = stem or file_name

    body = json.dumps({"scene": scene, "file_name": request_file_name}, ensure_ascii=False)
    result = subprocess.run(
        TAI_AUTH_CMD + ["-u", token_url, "-m", "POST", "-b", body],
        capture_output=True,
        text=True,
    )

    resp = result.stdout.strip()
    if not resp:
        msg = "获取 COS 临时密钥返回为空"
        if result.stderr:
            msg += f"；{result.stderr.strip()[:200]}"
        _fail("AuthError", msg)

    try:
        data = json.loads(resp)
    except (json.JSONDecodeError, ValueError):
        _fail("HTTPError", f"COS 临时密钥响应非 JSON: {resp[:200]}")

    cred = _find_cred_dict(data)
    if not cred:
        _fail("HTTPError", f"COS 临时密钥响应中未找到临时密钥: {resp[:300]}")

    required = ("TmpSecretId", "TmpSecretKey", "SessionToken", "Bucket", "Region", "Key")
    missing = [k for k in required if not cred.get(k)]
    if missing:
        _fail("HTTPError", f"临时密钥缺少字段 {missing}: {resp[:300]}")

    log("Step 1: 临时密钥获取成功")
    cred["_ext"] = ext
    return cred


def _find_cred_dict(obj):
    """递归查找包含临时密钥的字典（兼容网关多层包裹结构）"""
    if isinstance(obj, dict):
        if "TmpSecretId" in obj and "TmpSecretKey" in obj:
            return obj
        for value in obj.values():
            found = _find_cred_dict(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find_cred_dict(value)
            if found:
                return found
    return None


# ===== COS 请求签名（q-sign-algorithm=sha1）=====
def _hmac_sha1(key, msg):
    return hmac.new(key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha1).hexdigest()


def _sha1(msg):
    return hashlib.sha1(msg.encode("utf-8")).hexdigest()


def _format_pairs(pairs):
    """对 key 转小写并 UrlEncode，按 key 字典序排序，返回 (list_str, kv_str)"""
    encoded = sorted(
        (quote(k.lower(), safe=""), quote(str(v), safe="")) for k, v in pairs.items()
    )
    list_str = ";".join(k for k, _ in encoded)
    kv_str = "&".join(f"{k}={v}" for k, v in encoded)
    return list_str, kv_str


def build_cos_authorization(secret_id, secret_key, method, uri_path, headers, params, start, end):
    key_time = f"{start};{end}"
    sign_key = _hmac_sha1(secret_key, key_time)

    header_list, http_headers = _format_pairs(headers)
    url_param_list, http_params = _format_pairs(params)

    http_string = f"{method.lower()}\n{uri_path}\n{http_params}\n{http_headers}\n"
    string_to_sign = f"sha1\n{key_time}\n{_sha1(http_string)}\n"
    signature = _hmac_sha1(sign_key, string_to_sign)

    return (
        "q-sign-algorithm=sha1"
        f"&q-ak={secret_id}"
        f"&q-sign-time={key_time}"
        f"&q-key-time={key_time}"
        f"&q-header-list={header_list}"
        f"&q-url-param-list={url_param_list}"
        f"&q-signature={signature}"
    )


# ===== Step 2: PUT 上传 =====
def upload_to_cos(cred, file_path):
    bucket = cred["Bucket"]
    region = cred["Region"]
    key = cred["Key"]
    # 补回原始扩展名（后端追加 _date_random 破坏了扩展名，
    # 这里在 Key 末尾补上 .ext，让 COS 上的文件保留正确后缀）
    ext = cred.get("_ext", "")
    if ext and not key.endswith(ext):
        key = key + ext
    host = f"{bucket}.cos.{region}.myqcloud.com"

    file_size = os.path.getsize(file_path)
    if file_size > LARGE_FILE_WARN_BYTES:
        log(f"文件较大 ({file_size // (1024 * 1024)} MB)，使用简单上传可能较慢")

    with open(file_path, "rb") as f:
        body = f.read()

    # 注意：COS 签名中的 URI 需使用原始 Key（可包含中文），
    # 但实际 HTTP 请求路径仍需使用 URL 编码后的路径。
    sign_uri_path = "/" + key
    request_uri_path = "/" + quote(key, safe="/")

    # 签名有效窗口直接用临时密钥的生效区间，保证落在有效期内
    start = int(cred.get("StartTime") or 0)
    end = int(cred.get("ExpiredTime") or 0)
    if not (start and end and end > start):
        start = int(time.time())
        end = start + 600

    # 仅签名 host 头，最大限度降低签名不一致风险
    authorization = build_cos_authorization(
        cred["TmpSecretId"], cred["TmpSecretKey"],
        "put", sign_uri_path, {"host": host}, {}, start, end,
    )

    headers = {
        "Host": host,
        "Authorization": authorization,
        "x-cos-security-token": cred["SessionToken"],
        "Content-Length": str(len(body)),
    }

    log(f"Step 2: 上传到 COS https://{host}{request_uri_path}")
    try:
        conn = HTTPSConnection(host, timeout=300)
        conn.request("PUT", request_uri_path, body=body, headers=headers)
        resp = conn.getresponse()
        resp_body = resp.read()
    except Exception as e:
        _fail("NetworkError", f"COS 上传请求失败: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    if resp.status not in (200, 204):
        detail = resp_body[:300].decode("utf-8", errors="replace")
        _fail("HTTPError", f"COS 返回 HTTP {resp.status}: {detail}")

    url = f"https://{host}{request_uri_path}"
    log("Step 2: 上传成功")
    return {
        "url": url,
        "bucket": bucket,
        "region": region,
        "key": key,
        "size": file_size,
    }


# ===== 主流程 =====
def main():
    parser = argparse.ArgumentParser(
        prog="cos_upload.py",
        description="本地文件上传到 COS，返回公网访问地址",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 cos_upload.py /abs/path/to/google_scan_xxx.xlsx
  python3 cos_upload.py /abs/path/to/file.csv --scene migraq
        """,
    )
    parser.add_argument("file", help="待上传文件的绝对路径")
    parser.add_argument("--scene", default="migraq", help="上传场景（默认 migraq）")
    parser.add_argument(
        "--token-url",
        default=DEFAULT_TEMP_CREDENTIAL_URL,
        help="COS 临时密钥网关地址（默认取环境变量或内置值）",
    )

    args = parser.parse_args()

    file_path = os.path.abspath(os.path.expanduser(args.file))
    if not os.path.isfile(file_path):
        _fail("ConfigError", f"文件不存在: {file_path}")

    parsed = urlparse(args.token_url)
    if parsed.scheme != "https" or not parsed.netloc.endswith(".woa.com"):
        _fail("ConfigError", f"token-url 必须是 *.woa.com 的 https 地址: {args.token_url}")

    file_name = os.path.basename(file_path)
    cred = get_temp_credential(args.token_url, args.scene, file_name)
    data = upload_to_cos(cred, file_path)
    data["file_name"] = file_name

    _print_json({
        "success": True,
        "action": "CosUpload",
        "data": data,
        "requestId": "",
    })
    sys.exit(0)


if __name__ == "__main__":
    main()
