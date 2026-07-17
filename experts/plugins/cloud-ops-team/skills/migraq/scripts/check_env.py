#!/usr/bin/env python3
"""
MigraQ 环境检测脚本（只读，不修改任何配置）

功能：检测 Python 版本、Skill 版本更新（含 changelog）、AK/SK 配置（可选）、Gateway 连通性

用法:
    python3 check_env.py                    # 标准模式：输出详细检测结果
    python3 check_env.py --quiet            # 静默模式：仅输出错误信息
    python3 check_env.py --skip-update      # 跳过版本更新检查

返回码:
    0 - 环境就绪（至少免鉴权功能可用）
    1 - Python 版本不满足（需要 3.7+）
    3 - Gateway 连通性失败（网络问题）

注意：AK/SK 未配置不再视为错误（返回码 0），因为大部分售前功能无需鉴权。
     JSON 摘要中会通过 auth_configured 字段标识鉴权状态。

跨平台支持: Windows / Linux / macOS
"""

import json
import os
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = SCRIPT_DIR / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

DEFAULT_GATEWAY_URL = "https://cmg.ai.tencentcloudapi.com"
DEFAULT_REGION = "ap-shanghai"
_SERVICE = "cmg"
_VERSION = "2024-10-15"
_ACTION = "ChatCompletions"

# 版本检查配置
#
# 版本号存在两处，必须保持同步：
#   1. SKILL.md front matter 中的 `version` 字段  ← check_env.py 读取此处做版本对比
#   2. _skillhub_meta.json 中的 `version` 字段   ← SkillHub 平台读取此处做安装/更新管理
#
# 每次升级版本时，两处都必须同步修改，否则会出现 check_env 版本与平台显示版本不一致的问题。
SKILL_MD_FILE = SCRIPT_DIR.parent / "SKILL.md"
VERSION_CHECK_TIMEOUT = 15  # 秒
VERSION_CHECK_URL = "https://msp.cloud.tencent.com/skill/version"

# ============== 输出控制 ==============
QUIET_MODE = "--quiet" in sys.argv
SKIP_UPDATE = "--skip-update" in sys.argv


def log_info(msg: str):
    if not QUIET_MODE:
        print(msg)


def log_ok(msg: str):
    if not QUIET_MODE:
        print(f"  [OK] {msg}")


def log_warn(msg: str):
    if not QUIET_MODE:
        print(f"  [WARN] {msg}")


def log_fail(msg: str):
    print(f"  [FAIL] {msg}")


def log_section(title: str):
    if not QUIET_MODE:
        print(f"\n=== {title} ===")


# ============== 版本检查 ==============

def parse_version(version_str: str) -> tuple:
    """解析语义化版本号，如 '1.0.0' -> (1, 0, 0)"""
    try:
        parts = version_str.strip().lstrip("v").split(".")
        return tuple(int(p) for p in parts)
    except (ValueError, AttributeError):
        return (0, 0, 0)


def get_local_version():
    """从 SKILL.md front matter 读取本地版本号，返回 (name, version_str) 或 (None, None)。

    注意：本地版本读取自 SKILL.md，而非 _skillhub_meta.json。
    _skillhub_meta.json 的 version 字段由 SkillHub 平台独立读取，两者需手动保持一致。

    解析 YAML front matter（--- 包裹的头部），提取 name 和 version 字段。
    使用简单的行扫描，无需依赖 PyYAML。
    """
    if not SKILL_MD_FILE.exists():
        return None, None
    try:
        text = SKILL_MD_FILE.read_text(encoding="utf-8")
        lines = text.splitlines()
        # 必须以 --- 开头才是 front matter
        if not lines or lines[0].strip() != "---":
            return None, None
        name, version = None, None
        for line in lines[1:]:
            if line.strip() == "---":
                break
            if line.startswith("name:"):
                name = line.split(":", 1)[1].strip().strip('"').strip("'")
            elif line.startswith("version:"):
                version = line.split(":", 1)[1].strip().strip('"').strip("'")
        return name, version
    except IOError:
        return None, None


def get_remote_version(name: str):
    """从 SkillHub 查询最新 Skill 版本，返回 (version_str, raw_data) 或 (None, None)

    接口: GET https://msp.cloud.tencent.com/skill/version
    响应: {"Response": {"Data": {"Version": "x.y.z"}}}
    """
    try:
        from urllib.request import urlopen, Request as _Req
        import ssl
        req = _Req(VERSION_CHECK_URL, headers={"Accept": "application/json"})
        ctx = ssl.create_default_context()
        with urlopen(req, context=ctx, timeout=VERSION_CHECK_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            version = data.get("Response", {}).get("Data", {}).get("Version")
            return version, data
    except Exception:
        return None, None


def check_version_update() -> dict:
    """检查本地版本与远端版本是否一致"""
    name, local_ver = get_local_version()
    if not name or not local_ver:
        return {
            "status": "no_meta",
            "message": "未找到 _skillhub_meta.json 或版本信息缺失",
        }

    remote_ver, remote_data = get_remote_version(name)
    if not remote_ver:
        return {
            "status": "check_failed",
            "local_version": local_ver,
            "message": "无法获取远端版本信息（网络问题或接口不可用）",
        }

    local_parsed = parse_version(local_ver)
    remote_parsed = parse_version(remote_ver)

    if remote_parsed <= local_parsed:
        return {
            "status": "up_to_date",
            "local_version": local_ver,
            "remote_version": remote_ver,
            "message": f"当前已是最新版本: {local_ver}",
        }

    # 收集 changelog（新接口暂不返回 changelog，预留扩展）
    changelog_lines = []
    versions = remote_data.get("Response", {}).get("Data", {}).get("Versions", []) if remote_data else []
    for v in versions:
        v_str = v.get("Version") or v.get("version", "")
        v_parsed = parse_version(v_str)
        if v_parsed > local_parsed:
            desc = v.get("Changelog") or v.get("changelog") or v.get("description") or ""
            changelog_lines.append(f"  {v_str}: {desc}" if desc else f"  {v_str}")

    if not changelog_lines and remote_data:
        latest_cl = (remote_data.get("Response", {}).get("Data", {}).get("Changelog", "")
                     or remote_data.get("latestVersion", {}).get("changelog", ""))
        if latest_cl:
            changelog_lines.append(f"  {remote_ver}: {latest_cl}")

    return {
        "status": "update_available",
        "local_version": local_ver,
        "remote_version": remote_ver,
        "changelog": changelog_lines,
        "message": f"发现新版本: {local_ver} → {remote_ver}",
    }


# ============== Gateway 连通性检测 ==============

def _tc3_sign(secret_key: str, secret_id: str, host: str, payload_str: str,
              action: str, version: str, region: str, timestamp: int) -> dict:
    """生成腾讯云 TC3-HMAC-SHA256 签名，返回请求头字典"""
    import hashlib, hmac as _hmac
    date = datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d")

    ct = "application/json"
    canonical_headers = f"content-type:{ct}\nhost:{host}\nx-tc-action:{action.lower()}\n"
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
    canonical_request = "\n".join([
        "POST", "/", "",
        canonical_headers, signed_headers, hashed_payload,
    ])

    algorithm = "TC3-HMAC-SHA256"
    credential_scope = f"{date}/{_SERVICE}/tc3_request"
    hashed_cr = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    string_to_sign = f"{algorithm}\n{timestamp}\n{credential_scope}\n{hashed_cr}"

    def _hmac_sha256(key: bytes, msg: str) -> bytes:
        return _hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    secret_date = _hmac_sha256(("TC3" + secret_key).encode("utf-8"), date)
    secret_service = _hmac_sha256(secret_date, _SERVICE)
    secret_signing = _hmac_sha256(secret_service, "tc3_request")
    signature = _hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    authorization = (
        f"{algorithm} Credential={secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "Host": host, "Content-Type": ct,
        "X-TC-Action": action, "X-TC-Version": version,
        "X-TC-Timestamp": str(timestamp), "X-TC-Region": region,
        "Authorization": authorization,
    }


def check_gateway_connectivity(gateway_url: str, secret_key: str,
                                secret_id: str = "") -> dict:
    """
    验证 CMG API 连通性和鉴权状态：发送 SSE 请求，读取前几行 SSE 数据判断结果。

    - HTTP 非 200 → 网络/HTTP 错误
    - HTTP 200 + SSE 流内含错误事件 → 鉴权失败或业务错误
    - HTTP 200 + 收到 delta 或 completed → 连通且鉴权正常

    Returns:
        {"ok": bool, "code": str, "message": str}
    """
    from http.client import HTTPSConnection
    import ssl

    host = "cmg.ai.tencentcloudapi.com"
    region = os.environ.get("CMG_REGION", DEFAULT_REGION)
    payload_str = json.dumps({"Input": "ping", "Stream": True}, separators=(",", ":"))

    now_ts = int(datetime.now(tz=timezone.utc).timestamp())
    headers = _tc3_sign(secret_key, secret_id, host, payload_str,
                        _ACTION, _VERSION, region, now_ts)
    headers["Accept"] = "text/event-stream"

    _AUTH_FAIL_CODES = {
        "AuthFailure.SecretIdNotFound",
        "AuthFailure.SignatureFailure",
        "AuthFailure.SignatureExpire",
        "AuthFailure.InvalidSecretId",
        "AuthFailure.TokenFailure",
        "AuthFailure.InvalidAuthorization",
    }

    try:
        ctx = ssl.create_default_context()
        conn = HTTPSConnection(host, context=ctx, timeout=20)
        conn.request("POST", "/", body=payload_str.encode("utf-8"), headers=headers)
        resp = conn.getresponse()
        status = resp.status

        if status in (401, 403):
            conn.close()
            return {"ok": False, "code": "AuthError", "message": f"鉴权失败 (HTTP {status})，请检查 AK/SK 是否正确"}

        if status != 200:
            conn.close()
            return {"ok": False, "code": "HTTPError", "message": f"CMG API 返回 HTTP {status}"}

        # HTTP 200：先检查 Content-Type
        # 鉴权失败时后端返回 text/plain + JSON 错误体（非 SSE 流）
        content_type = resp.getheader("Content-Type", "")
        if "text/plain" in content_type or "application/json" in content_type:
            try:
                body = resp.read().decode("utf-8")
                data = json.loads(body)
                err = data.get("Response", {}).get("Error", {})
                err_code = err.get("Code", "")
                err_msg = err.get("Message", "")
                if err_code in _AUTH_FAIL_CODES:
                    return {"ok": False, "code": "AuthError", "message": f"鉴权失败: {err_msg}"}
                if err_code:
                    return {"ok": False, "code": err_code, "message": err_msg}
            except Exception:
                pass
            finally:
                conn.close()
            return {"ok": True, "code": "OK", "message": "CMG API 连通正常"}

        # HTTP 200：读取前几行 SSE 数据判断鉴权和业务状态
        try:
            for _ in range(30):  # 最多读 30 行，避免无限等待
                raw = resp.readline()
                if not raw:
                    break
                line = raw.decode("utf-8").rstrip("\r\n")
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].lstrip()
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except (json.JSONDecodeError, ValueError):
                    continue

                event_type = data.get("type", "")

                # 收到任意进度/增量/完成事件 → 鉴权通过，连通正常
                if event_type in (
                    "run.started", "run.progress",
                    "message.delta", "message.completed",
                    # 兼容旧格式
                    "response.output_text.delta", "response.completed",
                ):
                    return {"ok": True, "code": "OK", "message": "CMG API 连通正常"}

                # 失败事件 → 提取错误信息
                if event_type in ("response.failed", "error"):
                    err = data.get("response", data).get("error", {})
                    err_code = err.get("code", "StreamError")
                    err_msg = err.get("message", str(data))
                    if err_code in _AUTH_FAIL_CODES or "auth" in err_code.lower():
                        return {"ok": False, "code": "AuthError", "message": f"鉴权失败: {err_msg}"}
                    return {"ok": False, "code": "StreamError", "message": err_msg}

                # 腾讯云标准错误结构（Response.Error）
                if "Response" in data:
                    err = data["Response"].get("Error", {})
                    err_code = err.get("Code", "")
                    err_msg = err.get("Message", "")
                    if err_code in _AUTH_FAIL_CODES:
                        return {"ok": False, "code": "AuthError", "message": f"鉴权失败: {err_msg}"}
                    if err_code:
                        return {"ok": False, "code": err_code, "message": err_msg}

            # 读完了但没有明确成功/失败事件，视为连通（接口已响应）
            return {"ok": True, "code": "OK", "message": "CMG API 连通正常"}
        finally:
            conn.close()

    except Exception as e:
        return {"ok": False, "code": "NetworkError", "message": f"连接异常: {e}"}


# ============== 主流程 ==============

def main():
    # ver_result 在版本检查后用于最终 JSON 摘要
    ver_result = None

    # ============== 1. 检查 Python 版本 ==============
    log_section("1. 检查运行环境")

    py_ver = sys.version_info
    if py_ver < (3, 7):
        log_fail(f"Python 版本过低: {sys.version}，需要 Python 3.7+")
        sys.exit(1)

    log_ok(f"Python {py_ver.major}.{py_ver.minor}.{py_ver.micro} ({platform.system()} {platform.machine()})")

    # ============== 2. 检查 Skill 版本更新 ==============
    log_section("2. 检查 Skill 版本")

    if SKIP_UPDATE:
        log_ok("已跳过版本更新检查（--skip-update）")
    else:
        ver_result = check_version_update()
        status = ver_result["status"]

        if status == "up_to_date":
            log_ok(ver_result["message"])
        elif status == "update_available":
            log_warn(f"发现新版本 {ver_result['remote_version']}（当前 {ver_result['local_version']}），可前往 SkillHub 更新")
            changelog = ver_result.get("changelog", [])
            if changelog:
                log_info("")
                log_info("  === Changelog ===")
                for line in changelog:
                    log_info(line)
                log_info("")
        elif status in ("check_failed", "no_meta"):
            log_warn(ver_result["message"])
            log_info("  版本检查跳过，继续后续检测...")

    # ============== 3. 检查 AK/SK 配置（可选，不阻断） ==============
    log_section("3. 检查 AK/SK 配置")

    secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID", "")
    secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY", "")
    auth_configured = bool(secret_id and secret_key)

    if not auth_configured:
        missing = []
        if not secret_id:
            missing.append("TENCENTCLOUD_SECRET_ID")
        if not secret_key:
            missing.append("TENCENTCLOUD_SECRET_KEY")
        log_warn(f"未配置: {', '.join(missing)}")
        log_info("  售前功能（扫描、推荐、TCO分析等）无需密钥，可正常使用")
        log_info("  迁移执行、集群管理等操作需要配置密钥后使用")
        log_info("")
        log_info("  配置方法:")
        log_info("  Linux / macOS:")
        log_info('    echo \'export TENCENTCLOUD_SECRET_ID="your-secret-id"\' >> ~/.zshrc')
        log_info('    echo \'export TENCENTCLOUD_SECRET_KEY="your-secret-key"\' >> ~/.zshrc')
        log_info("    source ~/.zshrc")
        log_info("")
        log_info("  Windows PowerShell:")
        log_info('    [Environment]::SetEnvironmentVariable("TENCENTCLOUD_SECRET_ID", "your-secret-id", "User")')
        log_info('    [Environment]::SetEnvironmentVariable("TENCENTCLOUD_SECRET_KEY", "your-secret-key", "User")')
        log_info("")
        log_info("  密钥获取地址: https://console.cloud.tencent.com/cam/capi")
    else:
        masked_id = f"{secret_id[:4]}****{secret_id[-4:]}" if len(secret_id) > 8 else "****"
        log_ok(f"TENCENTCLOUD_SECRET_ID 已配置: {masked_id}")
        log_ok("TENCENTCLOUD_SECRET_KEY 已配置: ****")

    # ============== 4. 验证 CMG API 连通性 ==============
    log_section("4. 验证 CMG API 连通性")

    cmg_host = "cmg.ai.tencentcloudapi.com"
    log_ok(f"CMG API: https://{cmg_host}/")

    if auth_configured:
        conn_result = check_gateway_connectivity(cmg_host, secret_key, secret_id)

        if conn_result["ok"]:
            log_ok(conn_result["message"])
        else:
            code = conn_result["code"]
            msg = conn_result["message"]
            if code == "AuthError":
                log_fail(f"鉴权失败: {msg}")
                log_info("  请检查 TENCENTCLOUD_SECRET_KEY 是否正确")
                log_info("  售前功能仍可正常使用（无需鉴权）")
                auth_configured = False  # 标记鉴权不可用
            else:
                log_fail(f"Gateway 连通性失败: {msg}")
                log_info(f"  请检查网络是否可达 ({cmg_host})")
                sys.exit(3)
    else:
        log_info("  AK/SK 未配置，跳过鉴权连通性验证")
        log_info("  免鉴权功能（售前流程）仅需网络可达即可")

    # ============== 检测完成 ==============
    log_info("")
    log_info("=== 检测完成 ===")
    if auth_configured:
        log_ok("环境就绪，所有功能可用（含鉴权功能）")
    else:
        log_ok("环境就绪，售前功能可用（扫描、推荐、TCO 分析等）")
        log_info("  配置 AK/SK 后可解锁迁移执行、集群管理等功能")
    log_info("")
    log_info(f"  [OK] Python {py_ver.major}.{py_ver.minor} ({platform.system()})")
    if auth_configured:
        masked_id = f"{secret_id[:4]}****{secret_id[-4:]}" if len(secret_id) > 8 else "****"
        log_info(f"  [OK] AK/SK 已配置（SecretId: {masked_id}）")
        log_info(f"  [OK] Gateway 鉴权连通正常")
    else:
        log_info(f"  [--] AK/SK 未配置（售前功能不影响）")

    # 输出结构化 JSON 摘要（供 AI 解析），始终打印（不受 --quiet 影响）
    summary = {"status": "ready", "auth_configured": auth_configured}
    if not SKIP_UPDATE and ver_result and ver_result.get("status") == "update_available":
        summary["update_available"] = True
        summary["local_version"] = ver_result.get("local_version", "")
        summary["remote_version"] = ver_result.get("remote_version", "")
    print(json.dumps(summary, ensure_ascii=False))

    sys.exit(0)


if __name__ == "__main__":
    main()
