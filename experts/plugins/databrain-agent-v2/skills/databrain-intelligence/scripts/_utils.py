"""Shared helpers for databrain-intelligence scripts.

- load_dotenv: 从脚本所在目录加载 .env（不读 cwd，避免被任意工作目录污染）
- get_token:   读取 API token，优先取 DATABRAIN_TOKEN（与服务端 run_skill_script
               注入的环境变量保持一致），向后兼容旧的 TAI_IT_TOKEN 作为 fallback
- check_http_auth: 统一处理 401/403 并给出友好提示
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# 主 token env：服务端 tools/run_skill_script.py 注入的就是 DATABRAIN_TOKEN，
# 这里保持一致，确保 per-request token 真正生效。
TOKEN_ENV = "DATABRAIN_TOKEN"
# 兼容旧的本地调试 .env（写 TAI_IT_TOKEN 的）；DATABRAIN_TOKEN 不存在时才回退。
LEGACY_TOKEN_ENV = "TAI_IT_TOKEN"
HOST_ENV = "DATABRAIN_HOST"
# 数据源 uuid：服务端 run_skill_script 会以 DATABRAIN_DATABASE_UUID 注入；
# 默认 15000 与历史脚本一致。
DATABASE_UUID_ENV = "DATABRAIN_DATABASE_UUID"
DEFAULT_DATABASE_UUID = "15000"

# .env 中允许出现的 key（包含 token —— 用户已确认允许 .env 存敏感字段以方便本地调试）
_ALLOWED_ENV_KEYS = {TOKEN_ENV, LEGACY_TOKEN_ENV, HOST_ENV, DATABASE_UUID_ENV, "PLATFORM"}

TOKEN_HELP = (
    "请设置 DataBrain 请求 token（原始值，不含 Bearer 前缀）。\n"
    "可选方式：\n"
    "  1. 系统环境变量 export DATABRAIN_TOKEN=<token>（生产由服务端自动注入）\n"
    "  2. skill 根目录 .env 文件中写 DATABRAIN_TOKEN=<token>（与 scripts/ 平级，本地调试推荐）\n"
    "  3. 命令行参数 --token <token>\n"
    "  4. 旧的 TAI_IT_TOKEN 仍作为兼容 fallback（不推荐新写）"
)


def load_dotenv() -> None:
    """加载 skill 目录下的 .env 到 os.environ（已存在的环境变量不会被覆盖）。

    查找顺序（先命中者优先；优先级高于默认值但低于已存在的环境变量）：
    1. <skill_root>/.env          （与 SKILL.md / scripts/ 同级，**推荐位置**）
    2. <skill_root>/scripts/.env  （脚本同级，兼容位置）

    安全策略：
    - **不读** cwd 的 .env，避免被任意工作目录污染。
    - 仅加载白名单 key（DATABRAIN_TOKEN / TAI_IT_TOKEN / DATABRAIN_HOST / PLATFORM）。
    """
    scripts_dir = Path(__file__).resolve().parent
    skill_root = scripts_dir.parent
    for env_path in (skill_root / ".env", scripts_dir / ".env"):
        if not env_path.is_file():
            continue
        with env_path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k in _ALLOWED_ENV_KEYS and os.environ.get(k) is None:
                    os.environ[k] = v


def get_token(cli_token: str | None = None) -> str:
    """读取 API token。

    优先级（高 → 低）：
      1. 命令行参数 --token
      2. 系统环境变量 DATABRAIN_TOKEN（生产由服务端 run_skill_script 注入）
      3. skill 目录 .env 中的 DATABRAIN_TOKEN
      4. 旧的 TAI_IT_TOKEN 系统环境变量 / .env（向后兼容）

    返回原始 token 值（不含 Bearer 前缀）。找不到时返回空字符串。
    """
    if cli_token:
        return cli_token.strip()
    load_dotenv()
    token = os.environ.get(TOKEN_ENV, "").strip()
    if token:
        return token
    return os.environ.get(LEGACY_TOKEN_ENV, "").strip()


def get_host(cli_host: str | None = None, default: str = "https://databrain.mcp.it.woa.com") -> str:
    """读取 API host，优先级: 命令行参数 > 系统环境变量 DATABRAIN_HOST > .env 中的 DATABRAIN_HOST > 默认值。"""
    if cli_host:
        return cli_host.strip()
    load_dotenv()
    return os.environ.get(HOST_ENV, default).strip()


def get_database_uuid(cli_database_uuid: str | None = None, default: str = DEFAULT_DATABASE_UUID) -> str:
    """读取数据源 uuid。

    优先级（高 → 低）：
      1. 命令行参数 --database_uuid
      2. 系统环境变量 DATABRAIN_DATABASE_UUID（生产由服务端 run_skill_script 注入）
      3. skill 目录 .env 中的 DATABRAIN_DATABASE_UUID
      4. 内置默认值（DEFAULT_DATABASE_UUID = "15000"）
    """
    if cli_database_uuid:
        return str(cli_database_uuid).strip()
    load_dotenv()
    return os.environ.get(DATABASE_UUID_ENV, default).strip() or default


def require_token(cli_token: str | None = None) -> str:
    """读取 token；为空则打印提示并退出。"""
    token = get_token(cli_token)
    if not token:
        print(f"\n❌ 未找到 API Token (环境变量 {TOKEN_ENV})。\n{TOKEN_HELP}\n", file=sys.stderr)
        sys.exit(1)
    return token


def _format_request_detail(request_detail: dict | None) -> str:
    """Format API request context for auth-error diagnostics (stderr only)."""
    if not request_detail:
        return ""
    lines = ["\n[request detail]"]
    for key in ("url", "game_code", "database_uuid", "schema", "skill_name", "timeout_ms", "limit"):
        if key in request_detail and request_detail[key] is not None:
            lines.append(f"  {key}: {request_detail[key]}")
    sql = request_detail.get("sql")
    if sql:
        preview = sql if len(sql) <= 500 else sql[:500] + "..."
        lines.append(f"  sql: {preview}")
    cli_cmd = request_detail.get("cli_command")
    if cli_cmd:
        lines.append(f"  cli_command: {cli_cmd}")
    return "\n".join(lines) + "\n"


def check_http_auth(resp, request_detail: dict | None = None) -> None:
    """在 raise_for_status 之前拦截 401/403，给出友好提示。"""
    detail = _format_request_detail(request_detail)
    if resp.status_code == 401:
        print(
            f"\n❌ 认证失败 (HTTP 401): Token 无效或已过期。\n{TOKEN_HELP}\n{detail}",
            file=sys.stderr,
        )
        sys.exit(1)
    if resp.status_code == 403:
        schema_hint = ""
        if request_detail and request_detail.get("schema") == "benchmark":
            schema_hint = (
                "提示：benchmark 查询不要传 --schema benchmark（会 403）。"
                "去掉 --schema，SQL 中使用 benchmark.* 全限定表名。\n"
            )
        print(
            "\n❌ 无权限 (HTTP 403): 当前用户没有该数据的访问权限。\n"
            f"{schema_hint}"
            "请联系数据管理员申请对应 game_code / 数据表的权限。\n"
            f"{detail}",
            file=sys.stderr,
        )
        sys.exit(1)
