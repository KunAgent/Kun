#!/usr/bin/env python3
"""
天穹大数据平台 Skill 管道工具脚本（skill-context）。

提供 Skill 执行管道中的两个步骤：
1. init      — 权限校验：校验 security_file/config.json 中 user/cmk/cmk_id 是否非空，每次会话只前置校验一次，成功后不再次执行。
2. execute   — 执行上报：通过命令行参数直接上报，脚本内部将 user_query 做 base64 编码后发送，每次调用skill必须执行！！！

用法:
    python3 context.py init

    # 单条上报
    python3 context.py execute --skill-source "HDFS/xxx" --api-path "/api/xxx" --user-query "用户原始问题"

    # 批量上报（多次指定 --skill-source / --api-path / --user-query，按顺序一一对应）
    python3 context.py execute \\
        --skill-source "HDFS/a" --api-path "/api/a;/api/b" --user-query "问题1" \\
        --skill-source "HDFS/b" --api-path "/api/c;/api/d" --user-query "问题2"
"""

import argparse
import base64
from typing import Optional
import json
import sys
import textwrap
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

from auth_utils import get_effective_user, is_agent_mode

# ── 配置 ────────────────────────────────────────────────────────────────

CONTEXT_API_URL = "http://do-mcp.server.woa.com:8080/api/audit/skill_usage"
REQUEST_TIMEOUT = 5

# 项目根目录：context.py → scripts/ → skill-context/ → SkillBase/ → sub-skills/ → 项目根（向上 5 级）
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
CONFIG_FILE = PROJECT_ROOT / "security_file" / "config.json"
SUB_SKILLS_DIR = PROJECT_ROOT / "sub-skills"

# 管道就绪标记文件：init 成功后写入，业务脚本启动时检查此文件是否存在
PIPELINE_READY_FILE = PROJECT_ROOT / ".pipeline_ready"

# 北京时间
BJT = timezone(timedelta(hours=8))


# ── 工具函数 ──────────────────────────────────────────────────────────────

def _load_config() -> dict:
    """读取 security_file/config.json。"""
    if not CONFIG_FILE.exists():
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"[pipeline] 警告: 读取配置文件失败: {e}", file=sys.stderr)
        return {}


def _read_skill_version(skill_source: str) -> str:
    """从 tencent-bigdata/sub-skills/{subsystem}/{skill_name}/version 文件读取版本号。

    支持两种 skill_source 格式：
    - "{subsystem}/{skill_name}"（如 "HDFS/hdfs-cluster-load-diagnose"）→ 直接定位
    - "{skill_name}"（如 "hdfs-cluster-load-diagnose"）→ 遍历所有子系统查找

    Returns:
        版本号字符串，读取失败返回空字符串。
    """
    skill_source = skill_source.strip("/")

    if "/" in skill_source:
        subsystem, skill_name = skill_source.split("/", 1)
        version_file = SUB_SKILLS_DIR / subsystem / skill_name / "version"
        if version_file.exists():
            try:
                return version_file.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        return ""

    if SUB_SKILLS_DIR.exists():
        for subsystem_dir in sorted(SUB_SKILLS_DIR.iterdir()):
            if not subsystem_dir.is_dir():
                continue
            version_file = subsystem_dir / skill_source / "version"
            if version_file.exists():
                try:
                    return version_file.read_text(encoding="utf-8").strip()
                except OSError:
                    pass
    return ""


def _build_context_data(
    skill_source: str,
    api_path: str = "",
    user_query: str = "",
    config: Optional[dict] = None,
) -> dict:
    """构造单条上下文数据。

    user_query 会在内部做 base64 编码后放入请求体，由后端自行解码。
    """
    if config is None:
        config = _load_config()

    now = datetime.now(BJT)

    if len(user_query) > 1024:
        user_query = user_query[:1024]

    user_query_b64 = base64.b64encode(user_query.encode("utf-8")).decode("utf-8")

    return {
        "user": get_effective_user(config.get("user", "")),
        "skill_source": skill_source,
        "skill_version": _read_skill_version(skill_source),
        "api_path": api_path,
        "user_query": user_query_b64,
        "client_ts": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "log_time": "",
    }


def _submit_context(payload: dict) -> dict:
    """将上下文数据提交到平台 API,即必须执行步骤：访问上报。

    Args:
        payload: 上下文数据 dict
    Returns:
        API 响应 JSON（失败时返回 {"success": False, "error": "..."}）
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        CONTEXT_API_URL,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            resp_body = resp.read().decode("utf-8")
            try:
                return json.loads(resp_body)
            except json.JSONDecodeError:
                return {"success": True, "raw": resp_body}
    except (URLError, HTTPError, OSError) as e:
        return {"success": False, "error": str(e)}


# ── 子命令：init ──────────────────────────────────────────────────────────

def cmd_init(_args: argparse.Namespace) -> None:
    """权限校验：检查 config.json 中 user、cmk 和 cmk_id 是否非空。"""
    print("[pipeline] 执行权限校验 ...")

    if not CONFIG_FILE.exists():
        print(f"[pipeline] ✗ 校验失败: 配置文件不存在 ({CONFIG_FILE})")
        print()
        _print_config_template()
        sys.exit(1)

    config = _load_config()
    if not config:
        print(f"[pipeline] ✗ 校验失败: 配置文件为空或格式错误")
        print()
        _print_config_template()
        sys.exit(1)

    missing = []
    config_user = config.get("user", "").strip()
    user_val = get_effective_user(config_user)
    cmk_val = config.get("cmk", "").strip()
    cmk_id_val = config.get("cmk_id", "").strip()

    if not user_val:
        missing.append("user")
    if not cmk_val:
        missing.append("cmk")
    if not cmk_id_val:
        missing.append("cmk_id")

    if missing:
        print(f"[pipeline] ✗ 校验失败: 以下字段为空: {', '.join(missing)}")
        print()
        _print_config_template()
        sys.exit(1)

    # 写入管道就绪标记文件，供业务脚本启动时校验
    _write_pipeline_ready_marker(user_val)

    print(f"[pipeline] ✓ 权限校验通过")
    if is_agent_mode():
        print(f"  模式:   Agent（代理模式）")
        print(f"  操作人: {user_val}（来自环境变量）")
    else:
        print(f"  操作人: {user_val}")
    print(f"  CMK:    {cmk_val[:8]}{'*' * max(0, len(cmk_val) - 8)}")
    print(f"  CMK_ID: {cmk_id_val}")
    sys.exit(0)


def _write_pipeline_ready_marker(user: str = "") -> None:
    """写入管道就绪标记文件。

    业务脚本在 main() 入口处会检查此文件是否存在，
    如果不存在则拒绝执行并输出管道引导信息。
    标记文件包含时间戳和操作人信息，便于调试。
    """
    try:
        now = datetime.now(BJT)
        marker = {
            "pipeline_ready": True,
            "user": user,
            "timestamp": now.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        PIPELINE_READY_FILE.parent.mkdir(parents=True, exist_ok=True)
        PIPELINE_READY_FILE.write_text(
            json.dumps(marker, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except OSError:
        pass  # 标记写入失败不阻塞主流程


def _print_config_template():
    """打印 config.json 模板，引导用户补充身份信息。"""
    print("请在项目根目录的 security_file/config.json 中填写您的身份信息：")
    print()
    print(textwrap.dedent("""\
        {
            "user": "your_rtx_id",
            "cmk": "your_cmk_token",
            "cmk_id": "your_cmk_id"
        }
    """))
    print(f"配置文件路径: {CONFIG_FILE}")


# ── 子命令：execute ───────────────────────────────────────────────────────

def cmd_execute(args: argparse.Namespace) -> None:
    """执行上报：通过命令行参数接收数据并提交。

    调用方直接传原始 user_query 明文，脚本内部在 _build_context_data 中
    自动做 base64 编码后发送给后端，后端自行解码。
    支持单条和批量（多次指定 --skill-source / --api-path / --user-query）。
    """
    sources = args.skill_source or []
    api_paths = args.api_path or []
    queries = args.user_query or []

    if not sources:
        print("[pipeline] ✗ 未提供 --skill-source 参数", file=sys.stderr)
        return

    config = _load_config()

    for i, source in enumerate(sources):
        api_path = api_paths[i] if i < len(api_paths) else ""
        user_query = queries[i] if i < len(queries) else ""

        payload = _build_context_data(
            skill_source=source,
            api_path=api_path,
            user_query=user_query,
            config=config,
        )
        _submit_context(payload)


# ── 入口 ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="天穹大数据平台 Skill 管道工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
示例:
  # 权限校验
  %(prog)s init

  # 单条上报
  %(prog)s execute --skill-source "HDFS/xxx" --api-path "/api/xxx" --user-query "用户原始问题"

  # 批量上报（多次指定，按顺序一一对应）
  %(prog)s execute \\
      --skill-source "HDFS/a" --api-path "/api/a;/api/b" --user-query "问题1" \\
      --skill-source "HDFS/b" --api-path "/api/c;/api/d" --user-query "问题2"
        """),
    )
    subparsers = parser.add_subparsers(dest="command", help="可用子命令")

    # init — 权限校验
    p_init = subparsers.add_parser("init", help="权限校验（Step 2）")
    p_init.set_defaults(func=cmd_init)

    # execute — 执行上报
    p_execute = subparsers.add_parser("execute", help="执行上报（Step 4）")
    p_execute.add_argument(
        "--skill-source", dest="skill_source", action="append",
        help="Skill 来源，可多次指定（如 --skill-source A --skill-source B）",
    )
    p_execute.add_argument(
        "--api-path", dest="api_path", action="append",
        help="API 路径，可指定多个，多个用;分开，与 --skill-source 对应，不同skill使用的接口不同 ",
    )
    p_execute.add_argument(
        "--user-query", dest="user_query", action="append",
        help="用户原始查询（明文），脚本内部自动 base64 编码后发送给后端",
    )
    p_execute.set_defaults(func=cmd_execute)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
