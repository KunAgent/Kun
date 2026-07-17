#!/usr/bin/env python3
"""
社招 MCP 客户端 — JSON-RPC 2.0 over HTTP
基于《Python调用MCP搜索接口最佳实践》改造，适配社招接口。

依赖: pip install requests
"""

import base64
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

# ━━━━━━━━━━ Token 加载（多级回退，v6.1.7 重构） ━━━━━━━━━━

# 环境变量占位符正则: ${VAR_NAME}
_ENV_VAR_PATTERN = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)\}")


def _jwt_is_expired(jwt_token: str, skew_seconds: int = 60) -> bool:
    """
    检查 JWT 是否已过期（或即将过期 skew_seconds 秒内）。
    解析失败（如非 JWT 格式）→ 视为未过期（放行，让后端决定）。
    """
    try:
        parts = jwt_token.split(".")
        if len(parts) < 2:
            return False
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(payload))
        exp = decoded.get("exp", 0)
        if not exp:
            return False
        return time.time() + skew_seconds >= exp
    except Exception:
        return False


def _auth_is_expired(auth_value: str) -> bool:
    """检查 Authorization 头里的 Bearer JWT 是否过期"""
    if not auth_value or not auth_value.startswith("Bearer "):
        return False
    return _jwt_is_expired(auth_value[len("Bearer "):])


def _expand_env_vars(value: str) -> str:
    """
    把字符串里的 ${VAR} 占位符替换为环境变量的值。
    若某个变量在 env 中不存在，则返回空字符串（视为无效值）。

    示例:
        "Bearer ${TAI_IT_TOKEN}" → "Bearer eyJhbGciOi..."（TAI_IT_TOKEN 已设置）
        "Bearer ${NO_SUCH_VAR}"  → ""（视为未配置）
    """
    if not isinstance(value, str) or "${" not in value:
        return value
    missing = []

    def _sub(m):
        var = m.group(1)
        v = os.environ.get(var, "")
        if not v:
            missing.append(var)
        return v

    result = _ENV_VAR_PATTERN.sub(_sub, value)
    if missing:
        # 有变量没展开 → 整体视为无效
        return ""
    return result


def _is_placeholder(value: str) -> bool:
    """
    判断一个 token 值是否为占位符/说明文字，而非真实 token。

    典型占位符特征：
    - 空字符串
    - 含中文（真实 token 都是 ASCII）
    - 残留未展开的 ${...}
    - 字面量明示（如 "your token here", "xxx"）
    """
    if not value:
        return True
    if "${" in value:  # 未被展开的占位符
        return True
    # 含中文 → 几乎不可能是真实 token（HTTP header 也不支持）
    if any("\u4e00" <= ch <= "\u9fff" for ch in value):
        return True
    lowered = value.strip().lower()
    if lowered in ("your_token_here", "xxx", "todo", "tbd", "placeholder", "none", "null"):
        return True
    return False


def _load_dotenv():
    """从脚本同目录的 .env 文件加载环境变量（不覆盖已有的）"""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


def _candidate_config_paths():
    """
    返回 Token 发现的候选配置文件路径列表（按优先级）。

    v6.1.7 扩展覆盖范围：
    - mcporter 系列（Box 引擎/Box Workspace/用户级）← 真实 token 通常注入在此
    - WorkBuddy / CodeBuddy
    - AnyDev
    """
    home = Path.home()
    cwd = Path.cwd()
    return [
        # ==== mcporter 系列（优先：真实 token 常被 Box/mcporter 注入这里）====
        # Box 引擎 Workspace 级（运行时由引擎写入）
        home / ".box" / "Workspace" / "config" / "mcporter.json",
        # 当前 workspace 的 mcporter 配置（Box 项目级注入）
        cwd / "config" / "mcporter.json",
        # mcporter 用户级（~/.mcporter/mcporter.json，可能是模板值）
        home / ".mcporter" / "mcporter.json",
        # mcporter XDG 约定路径
        home / ".config" / "mcporter" / "mcporter.json",
        home / ".config" / "mcporter" / "config" / "mcporter.json",
        # ==== IDE 系列 ====
        home / ".workbuddy" / "mcp.json",                          # WorkBuddy 用户级
        cwd / ".codebuddy" / "mcp.json",                           # CodeBuddy 工作区级（兼容查找）
        cwd / ".mcp.json",                                          # 通用
        # ==== AnyDev ====
        Path("/data/workspace/config/mcporter.json"),
    ]


def auto_discover_tokens() -> tuple:
    """
    自动从已知配置文件中发现 recruit-mcp 的 Token。

    v6.1.7 升级：
    - 扩 mcporter 多路径（~/.box/Workspace/config、{cwd}/config、~/.mcporter、~/.config/mcporter 等）
    - 支持 ${VAR} 环境变量占位符展开（解决 mcporter 模板配置）
    - 跳过占位符/说明文字（中文字面量、未展开的 ${...} 等）
    - 分别收集 Authorization / recruit-Authorization，允许跨文件组合（Auth 来自 A，rAuth 来自 B）
    - JWT 过期检测：跳过已过期的 Authorization

    返回 (authorization, recruit_authorization)
    """
    best_auth = ""       # 第一个非过期非占位符的 Authorization
    best_rauth = ""      # 第一个非占位符的 recruit-Authorization
    expired_auth = ""    # 最新但已过期的（兜底用）
    expired_sources = []
    fresh_source = None
    rauth_source = None

    for path in _candidate_config_paths():
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"[token] 解析 {path} 失败，跳过: {e}", file=sys.stderr)
            continue

        servers = config.get("mcpServers", config)
        if not isinstance(servers, dict):
            continue

        for name, server in servers.items():
            if not isinstance(server, dict):
                continue
            if "recruit" not in str(name).lower():
                continue

            headers = server.get("headers", {}) or {}
            auth_raw = headers.get("Authorization", "")
            rauth_raw = headers.get("recruit-Authorization", "")
            auth = _expand_env_vars(auth_raw)
            rauth = _expand_env_vars(rauth_raw)

            # Authorization 分类：有效 / 过期 / 占位符
            if not best_auth and auth and not _is_placeholder(auth):
                if _auth_is_expired(auth):
                    if not expired_auth:
                        expired_auth = auth
                    expired_sources.append(str(path))
                    print(f"[token] {path}: Authorization 已过期，跳过", file=sys.stderr)
                else:
                    best_auth = auth
                    fresh_source = str(path)

            # recruit-Authorization：只需非占位符
            if not best_rauth and rauth and not _is_placeholder(rauth):
                best_rauth = rauth
                rauth_source = str(path)

            # 两个都拿到就可以提前返回
            if best_auth and best_rauth:
                break
        if best_auth and best_rauth:
            break

    if best_auth and fresh_source:
        print(f"[token] Authorization 来源: {fresh_source}", file=sys.stderr)
    if best_rauth and rauth_source:
        print(f"[token] recruit-Authorization 来源: {rauth_source}", file=sys.stderr)

    # 如果 Authorization 未找到非过期版本，但有过期版本 → 告知调用方（由上层决定用 TAI_IT_TOKEN 兜底）
    if not best_auth and expired_auth:
        print(
            f"[token] ⚠️ 所有配置中的 Authorization 均已过期（{len(expired_sources)} 个来源），将尝试 TAI_IT_TOKEN 兜底",
            file=sys.stderr,
        )

    return best_auth, best_rauth


def _emit_need_auth(reason: str):
    """
    结构化输出到 stdout（供 agent 捕获），同时详细指引打到 stderr（给人看）。
    退出码 2 = 需要用户操作（区分于其他错误）。
    """
    payload = {
        "status": "need_auth",
        "reason": reason,
        "hint": "recruit-mcp Token 未找到或无效。请按以下任一方式配置：",
        "actions": [
            {
                "priority": 1,
                "method": "mcporter auth（推荐·托管 Box/mcporter 用户）",
                "command": "mcporter auth recruit-mcp",
                "note": "完成后会在 ~/.box/Workspace/config/mcporter.json 或 {cwd}/config/mcporter.json 写入真实 token，脚本会自动发现。",
            },
            {
                "priority": 2,
                "method": "环境变量（适合 CI / 容器）",
                "command": "export MCP_AUTH='Bearer xxx' && export MCP_RECRUIT_AUTH='mcp_xxx'",
                "note": "或仅设 TAI_IT_TOKEN（太湖统一 token），脚本会自动拼成 'Bearer ${TAI_IT_TOKEN}'，但 recruit-Authorization 仍需单独提供。",
            },
            {
                "priority": 3,
                "method": "脚本目录 .env 文件",
                "command": "echo 'MCP_AUTH=Bearer xxx\\nMCP_RECRUIT_AUTH=mcp_xxx' > {skillDir}/scripts/.env",
                "note": "适合不想污染全局环境变量的场景。",
            },
            {
                "priority": 4,
                "method": "降级方案：直接用 mcporter call 绕过本脚本",
                "command": "mcporter call recruit-mcp.CallAPI apiId:<id> params:<json>",
                "note": "agent 可在脚本持续失败时切换到此模式，功能等价但性能略差。",
            },
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print("", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print("ERROR: 未找到可用的 recruit-mcp Token", file=sys.stderr)
    print(f"原因: {reason}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print("请按以下任一方式配置（按推荐度排序）：", file=sys.stderr)
    print("  1. [推荐] 运行: mcporter auth recruit-mcp", file=sys.stderr)
    print("  2. [CI]  export MCP_AUTH='Bearer xxx' MCP_RECRUIT_AUTH='mcp_xxx'", file=sys.stderr)
    print("  3. [本地] 在 scripts/ 下建 .env：MCP_AUTH=... / MCP_RECRUIT_AUTH=...", file=sys.stderr)
    print("  4. [降级] agent 可切到 mcporter call recruit-mcp.CallAPI 直通", file=sys.stderr)
    print("", file=sys.stderr)
    print("💡 若已有 TAI_IT_TOKEN 环境变量，但 recruit-Authorization 仍缺失，", file=sys.stderr)
    print("   请先跑 'mcporter auth recruit-mcp' 完成首次认证写入。", file=sys.stderr)
    raise SystemExit(2)


def _pick_authorization(*candidates) -> str:
    """
    从若干 Authorization 候选值里挑一个"非占位符 + 未过期"的。
    若全部过期，返回最后一个候选（让后端给出明确 401，比提前崩更友好）。
    """
    fallback = ""
    for v in candidates:
        if not v or _is_placeholder(v):
            continue
        if _auth_is_expired(v):
            fallback = v
            continue
        return v
    return fallback


def get_mcp_credentials() -> tuple:
    """
    获取 MCP Token（v6.1.7 多级回退）。

    优先级：
      1. 环境变量 MCP_AUTH / MCP_RECRUIT_AUTH（完整显式）
      2. 配置文件自动发现（支持 ${VAR} 展开 + 占位符过滤 + 过期检测 + 跨文件组合）
      3. .env 文件
      4. TAI_IT_TOKEN 环境变量兜底 Authorization（当配置里的 Authorization 都过期或缺失时优先使用 env）
      5. 结构化报错 + 引导话术（stdout JSON + stderr 说明，exit 2）

    Authorization 挑选策略：env_new > config_fresh > TAI_IT_TOKEN > env_expired > config_expired
    recruit-Authorization 挑选策略：env > config > .env（无过期概念，非占位即可）
    """
    # 1. 环境变量
    env_auth = os.environ.get("MCP_AUTH", "")
    env_rauth = os.environ.get("MCP_RECRUIT_AUTH", "")

    # 2. 配置文件
    cfg_auth, cfg_rauth = auto_discover_tokens()

    # 3. .env 文件
    _load_dotenv()
    dotenv_auth = os.environ.get("MCP_AUTH", "") if not env_auth else ""
    dotenv_rauth = os.environ.get("MCP_RECRUIT_AUTH", "") if not env_rauth else ""

    # 4. TAI_IT_TOKEN 兜底（环境变量里的太湖统一 token，用户明确要求支持）
    tai_token = os.environ.get("TAI_IT_TOKEN", "")
    tai_auth = f"Bearer {tai_token}" if tai_token and not _jwt_is_expired(tai_token) else ""

    # 组装最终 Authorization：按优先级 env > config_fresh > TAI_IT_TOKEN > 过期兜底
    final_auth = _pick_authorization(env_auth, cfg_auth, tai_auth, dotenv_auth)

    # recruit-Authorization：env > config > .env（无过期检测，非占位即可）
    final_rauth = ""
    for cand in (env_rauth, cfg_rauth, dotenv_rauth):
        if cand and not _is_placeholder(cand):
            final_rauth = cand
            break

    # 日志
    if final_auth:
        if _auth_is_expired(final_auth):
            print("[token] ⚠️ Authorization 已过期，继续请求（后端会返回 401，建议运行 mcporter auth recruit-mcp）", file=sys.stderr)
        else:
            src = (
                "环境变量 MCP_AUTH" if final_auth == env_auth
                else "配置文件" if final_auth == cfg_auth
                else "环境变量 TAI_IT_TOKEN" if final_auth == tai_auth
                else ".env 文件"
            )
            print(f"[token] Authorization 最终来源: {src}", file=sys.stderr)
    if final_rauth:
        src = (
            "环境变量 MCP_RECRUIT_AUTH" if final_rauth == env_rauth
            else "配置文件" if final_rauth == cfg_rauth
            else ".env 文件"
        )
        print(f"[token] recruit-Authorization 最终来源: {src}", file=sys.stderr)

    # 5. 校验完整性
    if not final_auth:
        _emit_need_auth("Authorization 缺失（env / config / TAI_IT_TOKEN / .env 均无有效值）")
    if not final_rauth:
        _emit_need_auth(
            "recruit-Authorization 缺失。请运行 `mcporter auth recruit-mcp` 完成首次认证，"
            "或手动设置 MCP_RECRUIT_AUTH 环境变量"
        )

    return final_auth, final_rauth


# ━━━━━━━━━━ MCP 客户端 ━━━━━━━━━━

class MCPClient:
    """
    Recruit-MCP JSON-RPC 2.0 客户端（社招版）

    用法:
        client = MCPClient()
        result = client.search_social_resumes({...})
        detail = client.get_social_resume_detail("some-real-rid")
    """

    MCP_URL = "https://zhaopin.mcp.it.woa.com"

    # 社招接口 apiId
    SEARCH_API_ID = "recruit.social-resume.post_api_resume_query_query"
    DETAIL_API_ID = "recruit.social-resume.get_api_resume_detail_getresume_with_detail"

    def __init__(self, base_url: str = None, auth_token: str = None, recruit_auth: str = None):
        self.base_url = base_url or os.environ.get("MCP_URL", self.MCP_URL)

        if auth_token and recruit_auth:
            self._auth = auth_token
            self._recruit_auth = recruit_auth
        else:
            self._auth, self._recruit_auth = get_mcp_credentials()

        self._headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": self._auth,
            "recruit-Authorization": self._recruit_auth,
        }
        self._rpc_id = 0
        self._session_id = None

    def _next_id(self) -> int:
        self._rpc_id += 1
        return self._rpc_id

    # ── 初始化会话 ──

    def initialize(self):
        """初始化 MCP 会话（call_tool 会自动调用，也可手动调）"""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "social-search-client", "version": "1.0.0"},
            },
        }
        resp = requests.post(self.base_url, headers=self._headers, json=payload, timeout=30)
        resp.raise_for_status()

        sid = resp.headers.get("mcp-session-id") or resp.headers.get("Mcp-Session-Id")
        if sid:
            self._session_id = sid
            self._headers["mcp-session-id"] = sid

        result = resp.json()
        if "error" in result:
            raise RuntimeError(f"MCP 初始化失败: {result['error']}")

        # 发送 initialized 通知
        notify = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        requests.post(self.base_url, headers=self._headers, json=notify, timeout=10)
        print("[mcp] 会话初始化完成", file=sys.stderr)
        return result

    # ── 通用工具调用 ──

    def call_tool(self, tool_name: str, arguments: dict, timeout: int = 30, max_retries: int = 2) -> dict:
        """
        调用 MCP 工具，返回解析后的 JSON
        
        Args:
            tool_name: 工具名称
            arguments: 工具参数
            timeout: 单次请求超时时间（秒），默认 30 秒
            max_retries: 最大重试次数，默认 2 次
        """
        if not self._session_id:
            self.initialize()

        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                resp = requests.post(
                    self.base_url, 
                    headers=self._headers, 
                    json=payload, 
                    timeout=timeout
                )
                resp.raise_for_status()

                body = resp.json()
                if "error" in body:
                    raise RuntimeError(f"MCP 工具 {tool_name} 调用失败: {body['error']}")

                # 从 result.content[].text 中提取业务数据
                content = body.get("result", {}).get("content", [])
                for item in content:
                    if item.get("type") == "text":
                        try:
                            return json.loads(item["text"])
                        except json.JSONDecodeError:
                            return {"_raw": item["text"]}
                return body.get("result", {})
                
            except requests.exceptions.Timeout as e:
                last_error = e
                if attempt < max_retries:
                    wait_time = (attempt + 1) * 5  # 递增等待: 5s, 10s
                    print(f"  [retry] {tool_name} 超时，{wait_time}s 后重试 ({attempt + 1}/{max_retries})...", file=sys.stderr)
                    time.sleep(wait_time)
                    continue
                raise RuntimeError(f"MCP 工具 {tool_name} 超时（已重试 {max_retries} 次）: {e}")
            except requests.exceptions.RequestException as e:
                last_error = e
                if attempt < max_retries:
                    wait_time = (attempt + 1) * 3
                    print(f"  [retry] {tool_name} 网络错误，{wait_time}s 后重试 ({attempt + 1}/{max_retries})...", file=sys.stderr)
                    time.sleep(wait_time)
                    continue
                raise RuntimeError(f"MCP 工具 {tool_name} 网络错误（已重试 {max_retries} 次）: {e}")

    # ── 响应解包 ──

    @staticmethod
    def _unwrap(resp: dict) -> dict:
        """解开 MCP 响应嵌套: resp.data.data → 业务数据"""
        if resp is None:
            return {}
        data = resp
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        return data if data is not None else {}

    # ── 社招搜索 ──

    def search_social_resumes(self, params: dict) -> dict:
        """
        搜索社招简历。

        Args:
            params: 搜索参数（searchKey, location, from, size 等）

        Returns:
            {"resumes": [...], "totalCount": N} 或原始业务数据
        """
        raw = self.call_tool("CallAPI", {
            "apiId": self.SEARCH_API_ID,
            "params": params,
        })
        return self._unwrap(raw)

    # ── 社招详情 ──

    def get_social_resume_detail(self, rid: str) -> dict:
        """
        获取社招简历详情。

        Args:
            rid: 简历 RID（真实 UUID，搜索接口返回的 rid 字段）

        Returns:
            详情数据 dict
        """
        raw = self.call_tool("CallAPI", {
            "apiId": self.DETAIL_API_ID,
            "params": {"rid": rid, "fromPlace": "MCP"},
        })
        return self._unwrap(raw)


# ━━━━━━━━━━ 工具函数 ━━━━━━━━━━

def slim_search_result(resume: dict) -> dict:
    """
    从搜索结果中提取粗读需要的字段（节省落盘体积）。
    统一输出为小写驼峰字段名。
    """
    edu_list = resume.get("educationList") or []
    slim_edu = []
    for e in edu_list:
        slim_edu.append({
            "school": e.get("schoolName", e.get("SchoolName", "")),
            "degree": e.get("degree", e.get("Degree", "")),
            "major": e.get("major", e.get("Major", "")),
            "is985": e.get("is985", False),
            "is211": e.get("is211", False),
            "isC9": e.get("isC9", False),
            "overSea": e.get("overSea", False),
        })

    # 高亮字段: highLightOthers (list of objects or str)
    highlight = resume.get("highLightOthers") or resume.get("OtherHighlight") or []

    return {
        "rid": resume.get("rid", resume.get("Rid", "")),
        "extId": resume.get("extId", resume.get("ExtId", "")),
        "resumeId": resume.get("resumeId", resume.get("ResumeId", "")),
        "name": resume.get("name", resume.get("Name", "")),
        "gender": resume.get("gender", resume.get("Gender", "")),
        "age": resume.get("age", 0),
        "workPlace": resume.get("workPlace", resume.get("WorkPlace", "")),
        "expectWorkCitys": resume.get("expectWorkCitys", resume.get("ExpectWorkCitys", "")),
        "lastEduLevel": resume.get("lastEduLevel", resume.get("LastEduLevel", "")),
        "lastEduSchool": resume.get("lastEduSchool", resume.get("LastEduSchool", "")),
        "lastEduMajorName": resume.get("lastEduMajorName", resume.get("LastEduMajorName", "")),
        "lastEmployerName": resume.get("lastEmployerName", resume.get("LastEmployerName", "")),
        "lastEmployerTitle": resume.get("lastEmployerTitle", resume.get("LastEmployerTitle", "")),
        "lastEmployerIndustry": resume.get("lastEmployerIndustry", resume.get("LastEmployerIndustry", "")),
        "workYearsNumber": resume.get("workYearsNumber", 0),
        "workYearsText": resume.get("workYearsText", ""),
        "status": resume.get("status", resume.get("Status", 0)),
        "statusText": resume.get("statusText", resume.get("StatusText", "")),
        "locked": resume.get("locked", resume.get("Locked", 0)),
        "highLightOthers": highlight,
        "educationList": slim_edu,
        "updateTime": resume.get("updateTime", resume.get("UpdateTime", "")),
    }
