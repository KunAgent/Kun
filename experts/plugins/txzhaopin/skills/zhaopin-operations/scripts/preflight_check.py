"""
zhaopin-operations 环境预检脚本（跨平台: Windows / macOS / Linux）

在执行任何简历筛选操作之前，必须先运行此脚本，确保：
1. Node.js 已安装（mcporter 依赖）
2. mcporter 已全局安装
3. recruit-mcp 服务已配置（存在于 mcporter config 中）
4. Token 鉴权有效（通过轻量 API 调用验证）

返回值:
  exit code 0 — 所有检查通过，可以正常使用
  exit code 1 — 某项检查失败，stderr 中有详细说明和修复指引

输出格式 (stdout JSON):
  {
    "ok": true/false,
    "node": {"ok": true, "version": "v20.x.x", "path": "/usr/local/bin/node"},
    "mcporter": {"ok": true, "version": "1.x.x", "path": "/usr/local/bin/mcporter"},
    "config": {"ok": true, "has_recruit_mcp": true, "config_path": "..."},
    "auth": {"ok": true, "message": "鉴权验证通过"},
    "errors": [],
    "warnings": []
  }

用法:
  python preflight_check.py [--fix] [--json]

选项:
  --fix   自动修复可修复的问题（如自动安装 mcporter）
  --json  仅输出 JSON 结果，不打印可读文本（供其他脚本调用）
"""
import subprocess
import json
import sys
import os
import platform
import shutil
import pathlib
import re
import ssl
import urllib.request
import urllib.error


# ──────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────

def run_cmd(cmd, timeout=30, cwd=None):
    """运行命令并返回 (returncode, stdout, stderr)，跨平台兼容。"""
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True,
            shell=False, timeout=timeout, cwd=cwd,
            env=os.environ.copy()
        )
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except FileNotFoundError:
        return -1, "", f"命令未找到: {cmd[0]}"
    except subprocess.TimeoutExpired:
        return -2, "", f"命令超时 ({timeout}s)，通常是 Token 无效导致服务端无响应"
    except Exception as e:
        return -3, "", str(e)


def find_executable(name):
    """跨平台查找可执行文件路径。"""
    path = shutil.which(name)
    if path:
        return path
    # Windows 额外检查常见安装路径
    if platform.system() == "Windows":
        npm_prefix_rc, npm_prefix, _ = run_cmd(["npm", "config", "get", "prefix"])
        if npm_prefix_rc == 0 and npm_prefix:
            candidate = os.path.join(npm_prefix, f"{name}.cmd")
            if os.path.isfile(candidate):
                return candidate
    return None


def detect_workspace_root():
    """自动检测 Box Workspace 根目录（与 mcporter_call.py 保持一致）。"""
    env_val = os.environ.get("MCPORTER_WORKSPACE")
    if env_val and os.path.isdir(env_val):
        return env_val

    current = pathlib.Path.cwd()
    for ancestor in [current] + list(current.parents):
        if (ancestor / "config" / "mcporter.json").is_file():
            return str(ancestor)

    home = pathlib.Path.home()
    default = home / ".box" / "Workspace"
    if (default / "config" / "mcporter.json").is_file():
        return str(default)
    if default.is_dir():
        return str(default)

    return os.getcwd()


def resolve_mcporter_cmd(mcporter_path):
    """
    构建 mcporter 的实际调用命令列表。
    Windows 上如果是 .cmd shim，需要通过 node + cli.js 方式调用来避免管道符问题。
    对于预检，简单调用即可，不涉及管道符，所以直接用 mcporter_path。
    """
    return [mcporter_path]


# ──────────────────────────────────────────────
# 检查步骤
# ──────────────────────────────────────────────

def check_node():
    """检查 Node.js 是否可用。"""
    result = {"ok": False, "version": None, "path": None}

    node_path = find_executable("node")
    if not node_path:
        result["error"] = "Node.js 未安装"
        result["fix_hint"] = (
            "请安装 Node.js (v18+):\n"
            "  macOS:   brew install node\n"
            "  Windows: https://nodejs.org 下载安装包\n"
            "  Linux:   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
        )
        return result

    rc, stdout, stderr = run_cmd([node_path, "--version"])
    if rc != 0:
        result["error"] = f"Node.js 存在但无法获取版本: {stderr}"
        result["path"] = node_path
        return result

    result["ok"] = True
    result["version"] = stdout
    result["path"] = node_path

    # 检查版本 >= 18
    match = re.match(r"v(\d+)", stdout)
    if match and int(match.group(1)) < 18:
        result["warning"] = f"Node.js 版本 {stdout} 较低，建议升级到 v18+（mcporter 可能不兼容旧版本）"

    return result


def check_mcporter(auto_fix=False):
    """检查 mcporter 是否已安装。"""
    result = {"ok": False, "version": None, "path": None}

    mcporter_path = find_executable("mcporter")
    if not mcporter_path:
        if auto_fix:
            result["fixing"] = True
            print("⏳ mcporter 未找到，正在自动安装...", file=sys.stderr)
            rc, stdout, stderr = run_cmd(["npm", "install", "-g", "mcporter"], timeout=120)
            if rc == 0:
                mcporter_path = find_executable("mcporter")
                if mcporter_path:
                    result["ok"] = True
                    result["path"] = mcporter_path
                    result["fixed"] = "已自动安装 mcporter"
                    # 获取版本
                    rc2, ver, _ = run_cmd([mcporter_path, "--version"])
                    if rc2 == 0:
                        result["version"] = ver.strip()
                    return result
            result["error"] = f"自动安装 mcporter 失败: {stderr}"
            result["fix_hint"] = "请手动运行: npm install -g mcporter"
            return result

        result["error"] = "mcporter 未安装"
        result["fix_hint"] = "请运行以下命令安装:\n  npm install -g mcporter"
        return result

    result["path"] = mcporter_path

    rc, stdout, stderr = run_cmd([mcporter_path, "--version"])
    if rc == 0:
        result["version"] = stdout.strip()
    # 即使获取版本失败，mcporter 路径存在就认为已安装
    result["ok"] = True
    return result


def check_config(mcporter_path):
    """检查 recruit-mcp 服务是否已配置。"""
    result = {"ok": False, "has_recruit_mcp": False, "config_path": None}

    workspace_root = detect_workspace_root()
    result["workspace_root"] = workspace_root

    # 检查 project config 文件是否存在
    project_config = os.path.join(workspace_root, "config", "mcporter.json")
    system_config = os.path.join(str(pathlib.Path.home()), ".mcporter", "mcporter.json")

    config_found_in = None

    # 检查 project config
    if os.path.isfile(project_config):
        try:
            with open(project_config, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            servers = cfg.get("mcpServers", {})
            if "recruit-mcp" in servers:
                result["has_recruit_mcp"] = True
                config_found_in = "project"
                result["config_path"] = project_config
        except (json.JSONDecodeError, IOError):
            pass

    # 检查 system config
    if not result["has_recruit_mcp"] and os.path.isfile(system_config):
        try:
            with open(system_config, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            servers = cfg.get("mcpServers", {})
            if "recruit-mcp" in servers:
                result["has_recruit_mcp"] = True
                config_found_in = "system"
                result["config_path"] = system_config
        except (json.JSONDecodeError, IOError):
            pass

    if not result["has_recruit_mcp"]:
        result["error"] = "recruit-mcp 服务未配置"
        result["fix_hint"] = (
            "首选：在 WorkBuddy 弹出的「是否连接 recruit-mcp」窗口点「连接」→ 太湖 SSO 授权即可"
            "（无需手填 Token）。没弹窗就到「连接器」→「自定义连接器」→ recruit-mcp →「连接」。\n"
            "🆕 已不再需要「招活 Token」，连接只认太湖授权。\n\n"
            "仅当客户端不支持弹窗连接、需手动 CLI 时（只配太湖一个 header）:\n"
            "1. 获取太湖 Token: 访问 https://tai.it.woa.com/user/pat 创建 PAT\n"
            "   或使用 tai-oauth 技能自动获取（会设置环境变量 $TAI_IT_TOKEN）\n"
            "2. 执行配置命令:\n"
            '   mcporter config add recruit-mcp \\\n'
            '     --scope home \\\n'
            '     --url "https://zhaopin.mcp.it.woa.com" \\\n'
            '     --header "Authorization=Bearer $TAI_IT_TOKEN"'
        )
        return result

    result["ok"] = True
    result["config_location"] = config_found_in

    # 检查 headers 中是否有 Authorization 和 recruit-Authorization
    try:
        config_path = result["config_path"]
        with open(config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        server_cfg = cfg.get("mcpServers", {}).get("recruit-mcp", {})
        headers = server_cfg.get("headers", {})

        auth_val = (headers.get("Authorization") or "").strip()
        recruit_auth_val = (headers.get("recruit-Authorization") or "").strip()

        # 检查太湖 Token
        has_auth = bool(auth_val) and auth_val != "Bearer" and auth_val != "Bearer "
        # 检查招活 Token
        has_recruit_auth = bool(recruit_auth_val)

        result["has_tai_token"] = has_auth
        result["has_recruit_token"] = has_recruit_auth

        if not has_auth:
            result["missing_tai_token"] = True
        if not has_recruit_auth:
            result["missing_recruit_token"] = True
    except Exception:
        pass

    return result


def check_auth(mcporter_path):
    """
    通过 Python HTTP 直接验证 Token 是否有效。

    不走 mcporter CLI（mcporter 在无效 Token 下可能挂起/超时），
    而是从 mcporter.json 中读取 baseUrl + headers，直接用 urllib 发请求。
    参考 tai-oauth 的做法，更快更可控。
    """
    result = {"ok": False, "message": ""}

    # ── 1. 从 config 中读取 recruit-mcp 的 baseUrl 和 headers ──
    workspace_root = detect_workspace_root()
    project_config = os.path.join(workspace_root, "config", "mcporter.json")
    system_config = os.path.join(str(pathlib.Path.home()), ".mcporter", "mcporter.json")

    server_cfg = None
    for cfg_path in [project_config, system_config]:
        if os.path.isfile(cfg_path):
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                srv = cfg.get("mcpServers", {}).get("recruit-mcp")
                if srv:
                    server_cfg = srv
                    break
            except Exception:
                continue

    if not server_cfg:
        result["error"] = "无法读取 recruit-mcp 配置（应由 check_config 先检查）"
        return result

    base_url = server_cfg.get("baseUrl", "").rstrip("/")
    headers = server_cfg.get("headers", {})

    if not base_url:
        result["error"] = "recruit-mcp 配置中缺少 baseUrl"
        return result

    # ── 2. 构造 MCP initialize 请求验证鉴权 ──
    # 太湖 MCP 网关使用 Streamable HTTP 协议，必须先 initialize 建立 session。
    # 如果 Token 无效，网关在 initialize 阶段就会返回 401。
    # 如果 Token 有效，initialize 会返回 200 + session-id。
    # 所以只需发 initialize 即可判断鉴权状态，无需真正调用 tools/call。
    rpc_payload = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "preflight-check", "version": "1.0.0"}
        }
    }).encode("utf-8")

    # 构造请求头：从 config 中读取的 headers + Content-Type
    req_headers = {"Content-Type": "application/json"}
    for k, v in headers.items():
        req_headers[k] = v

    # SSL：兼容内网自签证书（与 tai-oauth 保持一致）
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    # ── 3. 发送请求 ──
    # mcporter 的 MCP 网关使用 SSE (Server-Sent Events) 协议
    # 先尝试 /sse 端点建立连接，但这对预检来说太重了
    # 直接用 /message 端点发送 JSON-RPC（如果网关支持）
    # 实际上太湖网关的 streamable HTTP 端点是 baseUrl 本身
    try:
        req = urllib.request.Request(
            base_url, data=rpc_payload, headers=req_headers, method="POST"
        )
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            # 尝试解析返回
            try:
                data = json.loads(body)
                if data.get("error"):
                    err_msg = data["error"].get("message", str(data["error"]))
                    if "401" in err_msg or "unauthorized" in err_msg.lower() or "auth" in err_msg.lower():
                        result["error"] = f"鉴权失败: {err_msg}"
                        result["fix_hint"] = _auth_fix_hint()
                    else:
                        # 有响应但有错误，可能是接口层面的，不一定是鉴权问题
                        result["ok"] = True
                        result["message"] = f"MCP 网关连通，API 返回错误但非鉴权问题: {err_msg[:100]}"
                elif data.get("result"):
                    result["ok"] = True
                    result["message"] = "鉴权验证通过，API 调用正常"
                else:
                    # 有响应但格式不确定，至少说明网关连通且鉴权通过
                    result["ok"] = True
                    result["message"] = "MCP 网关连通，鉴权通过"
            except json.JSONDecodeError:
                # 返回非 JSON（可能是 SSE 格式），说明连通了
                if len(body) > 0:
                    result["ok"] = True
                    result["message"] = "MCP 网关连通，鉴权通过（SSE 响应）"
                else:
                    result["error"] = "MCP 网关返回空响应"
        return result

    except urllib.error.HTTPError as e:
        status_code = e.code
        try:
            err_body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            err_body = ""

        if status_code == 401:
            result["error"] = "鉴权失败 (HTTP 401)，太湖 Token 已过期或无效"
            result["fix_hint"] = _auth_fix_hint()
        elif status_code == 403:
            result["error"] = f"权限不足 (HTTP 403): {err_body[:200]}"
            result["fix_hint"] = "请检查 recruit-Authorization Token 是否有效"
        elif status_code == 404:
            result["error"] = f"MCP 端点不存在 (HTTP 404): {base_url}"
            result["fix_hint"] = "请确认 baseUrl 配置正确: https://zhaopin.mcp.it.woa.com"
        else:
            result["error"] = f"HTTP {status_code}: {err_body[:200]}"
            result["fix_hint"] = "请运行 mcporter config doctor 排查"
        return result

    except urllib.error.URLError as e:
        reason = str(e.reason) if hasattr(e, "reason") else str(e)
        if "ECONNREFUSED" in reason or "Connection refused" in reason:
            result["error"] = f"网络连接被拒绝: {base_url}"
        elif "ETIMEDOUT" in reason or "timed out" in reason.lower():
            result["error"] = f"连接超时: {base_url}"
        elif "ENOTFOUND" in reason or "Name or service not known" in reason or "nodename nor servname" in reason.lower():
            result["error"] = f"域名解析失败: {base_url}"
        else:
            result["error"] = f"网络错误: {reason}"
        result["fix_hint"] = "请检查网络连接，确认可以访问 https://zhaopin.mcp.it.woa.com"
        return result

    except Exception as e:
        result["error"] = f"验证请求异常: {str(e)[:300]}"
        result["fix_hint"] = "请检查网络环境"
        return result


def _auth_fix_hint():
    """返回鉴权失败的统一修复指引。"""
    return (
        "太湖 Token 可能已过期，请重新获取:\n"
        "  方式1: 使用 tai-oauth 技能自动刷新\n"
        "  方式2: 访问 https://tai.it.woa.com/user/pat 重新创建 PAT\n"
        "然后重新配置（两个 Token 缺一不可）:\n"
        '  mcporter config add recruit-mcp \\\n'
        '    --scope home \\\n'
        '    --url "https://zhaopin.mcp.it.woa.com" \\\n'
        '    --header "Authorization=Bearer $TAI_IT_TOKEN" \\\n'
        '    --header "recruit-Authorization=<招活Token>"'
    )


# ──────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────

def main():
    auto_fix = "--fix" in sys.argv
    json_only = "--json" in sys.argv

    report = {
        "ok": False,
        "node": {},
        "mcporter": {},
        "config": {},
        "tai_token": {},
        "recruit_token": {},
        "auth": {},
        "errors": [],
        "warnings": [],
        "platform": platform.system(),
    }

    def log(msg):
        print(msg, file=sys.stderr, flush=True)

    def fail_and_exit():
        if json_only:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        sys.exit(1)

    # ── Step 1/5: Node.js ──
    log("🔍 [1/5] 检查 Node.js ...")
    node_result = check_node()
    report["node"] = node_result
    if node_result["ok"]:
        log(f"  ✅ Node.js {node_result['version']} ({node_result['path']})")
        if "warning" in node_result:
            log(f"  ⚠️  {node_result['warning']}")
            report["warnings"].append(node_result["warning"])
    else:
        log(f"  ❌ {node_result['error']}")
        report["errors"].append({"step": "node", "error": node_result["error"],
                                 "action": "install_node"})
        fail_and_exit()

    # ── Step 2/5: mcporter ──
    log("🔍 [2/5] 检查 mcporter ...")
    mcporter_result = check_mcporter(auto_fix=auto_fix)
    report["mcporter"] = mcporter_result
    if mcporter_result["ok"]:
        ver_str = mcporter_result.get('version', '未知版本')
        fixed_str = f" ({mcporter_result['fixed']})" if "fixed" in mcporter_result else ""
        log(f"  ✅ mcporter {ver_str} ({mcporter_result['path']}){fixed_str}")
    else:
        log(f"  ❌ {mcporter_result['error']}")
        report["errors"].append({"step": "mcporter", "error": mcporter_result["error"],
                                 "action": "install_mcporter"})
        fail_and_exit()

    mcporter_path = mcporter_result["path"]

    # ── Step 3/5: recruit-mcp 配置存在性 ──
    log("🔍 [3/5] 检查 recruit-mcp 配置 ...")
    config_result = check_config(mcporter_path)
    report["config"] = config_result
    if config_result["ok"]:
        loc = config_result.get("config_location", "unknown")
        log(f"  ✅ recruit-mcp 已配置 (来源: {loc} config)")
    else:
        log(f"  ❌ {config_result['error']}")
        report["errors"].append({"step": "config", "error": config_result["error"],
                                 "action": "configure_recruit_mcp"})
        fail_and_exit()

    # ── Step 4/5: Token 完整性检查（从配置文件检查） ──
    # 🆕 连接已只认太湖授权：只检查太湖 Token；招活 Token / recruit-Authorization 已下线，不再校验。
    log("🔍 [4/5] 检查太湖授权 ...")
    missing_tokens = []

    has_tai = config_result.get("has_tai_token", False)

    if has_tai:
        log("  ✅ 太湖 Token 已配置 (Authorization)")
        report["tai_token"] = {"ok": True, "configured": True}
    else:
        # 弹窗连接时鉴权由连接器注入、配置文件里可能看不到显式 header，
        # 因此这里不直接判失败，交给 Step 5 实际 HTTP 鉴权来定。
        log("  ⚠️ 配置文件未显式发现太湖 Token（若走弹窗连接属正常，由下一步实际鉴权验证）")
        report["tai_token"] = {"ok": None, "configured": False}

    if missing_tokens:
        fail_and_exit()

    # ── Step 5/5: 实际鉴权验证（HTTP 请求） ──
    log("🔍 [5/5] 验证 Token 鉴权（HTTP 请求） ...")
    auth_result = check_auth(mcporter_path)
    report["auth"] = auth_result
    if auth_result["ok"]:
        log(f"  ✅ {auth_result['message']}")
    else:
        log(f"  ❌ {auth_result['error']}")
        # 区分是太湖 Token 无效还是其他错误
        error_entry = {
            "step": "auth", "error": auth_result["error"],
            "action": "fix_auth"
        }
        if "401" in auth_result.get("error", ""):
            error_entry["action"] = "auto_tai_oauth"
            error_entry["hint"] = "太湖 Token 已过期，需重新获取"
        elif "403" in auth_result.get("error", ""):
            error_entry["action"] = "prompt_user_recruit_token"
            error_entry["hint"] = "招活 Token 可能无效，需用户重新提供"
        report["errors"].append(error_entry)
        fail_and_exit()

    # ── 汇总 ──
    report["ok"] = True
    log("\n🎉 所有检查通过！5 项条件全部满足，可以开始使用。")

    if report["warnings"]:
        log(f"⚠️  {len(report['warnings'])} 个警告（不影响使用，但建议关注）")

    if json_only:
        print(json.dumps(report, ensure_ascii=False, indent=2))

    sys.exit(0)


if __name__ == "__main__":
    main()
