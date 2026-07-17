"""inquiry-price-parallel 子 skill 入口的反向门控（CPQ 委托检测）。

设计动机
========
inquiry-price-parallel 既可以被 CPQ 主流程委托调用（作为 D 段询价的工具 ①），
也可以被用户独立调用（自由询价场景）。两种调用方式的合法性不同：

- 被 CPQ 委托：CPQ 主流程必须先跑完 A 段（产出 ``context.md`` + ``phase1.md``），
  以及条件触发的 B 段；否则上游契约被破坏，下游产物（summary.xlsx / phase4_1.md）
  来源不可追溯。
- 用户独立调用：用户直接调子 skill 做并发询价，与 CPQ 主流程无关，应当放行。

本模块的职责是**自动判断当前调用属于哪一种**，并对委托调用强校验 phase1.md
／context.md 的存在与完成标记。

判别信号（任一命中即视为"被 CPQ 委托"）
=====================================
1. 环境变量 ``CPQ_SESSION_DIR`` 已设置且指向一个存在的目录。
2. 当前 run-dir 位于 ``<某 CPQ 会话目录>/inquiry-run/`` 形式的路径下。
   识别规则：run-dir 的父目录名为 ``inquiry-run``，且其父目录（即 CPQ 会话目录）
   下存在 ``phase1.md`` 或 ``context.md`` 之一（说明这是 CPQ 会话目录而非随意目录）。
3. 显式环境变量 ``CPQ_DELEGATION=1`` 强声明。

放行（独立用户调用）
====================
- 上述信号均未命中
- 或 ``INQUIRY_SKIP_CPQ_GATE=1`` 紧急旁路开关（用于排障 / 测试），会在 stderr 打印警告

强校验内容（被委托时）
======================
- ``<CPQ_SESSION_DIR>/phase1.md`` 存在，且文件包含 ``<!-- phase1-done`` 标记
- ``<CPQ_SESSION_DIR>/context.md`` 存在，且文件包含 ``<!-- context-done`` 标记

校验失败 → 抛 ``CpqGateError``；CLI 层捕获后退出码 3（区别于已用的 0/1/10/20）。
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional, Tuple


GATE_EXIT_CODE = 3  # 与已有 0/1/10/20 错开
BYPASS_ENV = "INQUIRY_SKIP_CPQ_GATE"
DELEGATION_ENV = "CPQ_DELEGATION"
SESSION_DIR_ENV = "CPQ_SESSION_DIR"
INQUIRY_RUN_PARENT_NAME = "inquiry-run"

PHASE1_DONE_MARKER = "<!-- phase1-done"
CONTEXT_DONE_MARKER = "<!-- context-done"


class CpqGateError(RuntimeError):
    """CPQ 委托检测发现 A 段未完成时抛出。"""


@dataclass(frozen=True)
class DelegationDetection:
    """委托判定结果。"""

    delegated: bool
    session_dir: Optional[Path]
    reason: str  # 命中的信号名（"env_session_dir" / "run_dir_under_inquiry_run" / "explicit" / "none"）


def _looks_like_cpq_session_dir(p: Path) -> bool:
    """启发式：CPQ 会话目录通常含 phase1.md 或 context.md。

    用于路径推断分支——避免把"任意名为 inquiry-run 的目录的父目录"误判为 CPQ 会话目录。
    """
    if not p.is_dir():
        return False
    return (p / "phase1.md").exists() or (p / "context.md").exists()


def detect_cpq_delegation(
    run_dir: Path,
    env: Optional[Mapping[str, str]] = None,
) -> DelegationDetection:
    """识别当前调用是否来自 CPQ 主流程委托。

    Parameters
    ----------
    run_dir : Path
        本次 orchestrator 的 run-dir 绝对路径。
    env : Mapping[str, str], optional
        环境变量字典；默认读 ``os.environ``。便于测试注入。
    """
    if env is None:
        env = os.environ

    # 信号 3（显式）优先级最高
    if str(env.get(DELEGATION_ENV, "")).strip() == "1":
        sd = env.get(SESSION_DIR_ENV)
        return DelegationDetection(
            delegated=True,
            session_dir=Path(sd).resolve() if sd else None,
            reason="explicit",
        )

    # 信号 1：环境变量声明的 CPQ_SESSION_DIR
    sd_env = env.get(SESSION_DIR_ENV)
    if sd_env:
        sp = Path(sd_env).expanduser()
        if sp.is_dir():
            return DelegationDetection(
                delegated=True,
                session_dir=sp.resolve(),
                reason="env_session_dir",
            )

    # 信号 2：run-dir 路径暗示
    # 形如 <CPQ_SESSION_DIR>/inquiry-run/ 或 <CPQ_SESSION_DIR>/inquiry-run/<子目录>/
    try:
        run_dir_resolved = run_dir.resolve()
    except OSError:
        run_dir_resolved = run_dir

    # 向上回溯：找到第一个名为 inquiry-run 的祖先，其父目录即 CPQ 会话目录候选
    for ancestor in run_dir_resolved.parents:
        if ancestor.name == INQUIRY_RUN_PARENT_NAME:
            candidate_session_dir = ancestor.parent
            if _looks_like_cpq_session_dir(candidate_session_dir):
                return DelegationDetection(
                    delegated=True,
                    session_dir=candidate_session_dir,
                    reason="run_dir_under_inquiry_run",
                )
            # 即使父目录不像 CPQ 会话目录，名字命中也是强信号；按"看起来像被委托但 A 不完整"处理，
            # 让强校验阶段去报错（比静默放行安全）
            return DelegationDetection(
                delegated=True,
                session_dir=candidate_session_dir,
                reason="run_dir_under_inquiry_run",
            )

    return DelegationDetection(delegated=False, session_dir=None, reason="none")


def _read_text_safely(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def validate_cpq_phase_a(session_dir: Path) -> Tuple[bool, list]:
    """检查 CPQ A 段产物是否齐全。

    Returns
    -------
    (ok, errors)
        ``ok`` 为 True 表示 A 段完整；否则 ``errors`` 列出缺失/异常项。
    """
    errors: list = []
    if session_dir is None:
        return False, ["未能解析 CPQ_SESSION_DIR；委托检测信号不一致"]

    if not session_dir.is_dir():
        return False, [f"CPQ_SESSION_DIR 不存在或不是目录：{session_dir}"]

    phase1 = session_dir / "phase1.md"
    context = session_dir / "context.md"

    if not phase1.exists():
        errors.append(f"缺少 {phase1}（A 段未跑或未落盘）")
    else:
        text = _read_text_safely(phase1)
        if PHASE1_DONE_MARKER not in text:
            errors.append(f"{phase1} 缺少 phase1-done 标记（A 段未完成）")

    if not context.exists():
        errors.append(f"缺少 {context}（A 段 context 未产出）")
    else:
        text = _read_text_safely(context)
        if CONTEXT_DONE_MARKER not in text:
            errors.append(f"{context} 缺少 context-done 标记（A 段未完成）")

    return (len(errors) == 0), errors


def enforce(
    run_dir: Path,
    env: Optional[Mapping[str, str]] = None,
    *,
    stderr=sys.stderr,
) -> DelegationDetection:
    """主入口：检测委托 + 强校验。

    - 未被委托：直接返回检测结果，调用方继续。
    - 被委托但 ``INQUIRY_SKIP_CPQ_GATE=1``：打印警告后放行。
    - 被委托且 A 段不全：抛 ``CpqGateError``。
    """
    if env is None:
        env = os.environ

    detection = detect_cpq_delegation(run_dir, env)

    if not detection.delegated:
        return detection

    # 旁路开关
    if str(env.get(BYPASS_ENV, "")).strip() == "1":
        print(
            f"[cpq-gate] WARN: 检测到 CPQ 委托调用（reason={detection.reason}），"
            f"但 {BYPASS_ENV}=1 已设置 → 跳过 A 段校验。仅排障 / 测试可用。",
            file=stderr,
        )
        return detection

    ok, errors = validate_cpq_phase_a(detection.session_dir)
    if ok:
        return detection

    msg_lines = [
        "[cpq-gate] 检测到本次 inquiry-price-parallel 调用是被 CPQ 主流程委托的，但 A 段未完成：",
        f"  reason         : {detection.reason}",
        f"  session_dir    : {detection.session_dir}",
        f"  run_dir        : {run_dir}",
        "  failures       :",
    ]
    for e in errors:
        msg_lines.append(f"    - {e}")
    msg_lines.append("")
    msg_lines.append("处理建议：")
    msg_lines.append("  1) 回到 cpq skill 主流程，按 references/how-to-prepare-context.md 跑完 A 段")
    msg_lines.append("     （产出 context.md + phase1.md），然后由 fill-phase4-1.mjs 在 D 段调用本 skill。")
    msg_lines.append("  2) 如果当前是排障 / 单元测试，可临时设置 INQUIRY_SKIP_CPQ_GATE=1 跳过本检查。")
    msg_lines.append("  3) 如果当前是合法的独立用户调用，请确认 run-dir 未落在 <CPQ_SESSION_DIR>/inquiry-run/ 下，")
    msg_lines.append(f"     且未设置 {SESSION_DIR_ENV} / {DELEGATION_ENV}=1。")

    raise CpqGateError("\n".join(msg_lines))


__all__ = [
    "CpqGateError",
    "DelegationDetection",
    "GATE_EXIT_CODE",
    "BYPASS_ENV",
    "DELEGATION_ENV",
    "SESSION_DIR_ENV",
    "INQUIRY_RUN_PARENT_NAME",
    "detect_cpq_delegation",
    "validate_cpq_phase_a",
    "enforce",
]
