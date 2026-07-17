#!/usr/bin/env python3
"""
天穹大数据 Skills 热更新脚本。

每次执行 Skill 前调用，自动从远程 Skills Manager 检查并更新本地 Skills。
支持 sub-skills 目录结构和子系统级 SKILL.md 更新。

用法:
    python3 hot_reload.py
"""

import hashlib
import io
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional
from urllib.request import urlopen, Request
from urllib.error import URLError


SKILLS_BASE_URL = "http://bigdata-do-skills-manager.woa.com/api"
SKILLS_API_URL = f"{SKILLS_BASE_URL}/skills"
ROOT_SKILL_API_URL = f"{SKILLS_BASE_URL}/root-skill"

# 当前脚本位于 .codebuddy/skills/tencent-bigdata/sub-skills/SkillBase/skill-context/scripts/
_SCRIPT_DIR = Path(__file__).resolve().parent
# 向上回溯到 tencent-bigdata 根目录（scripts → skill-context → SkillBase → sub-skills → tencent-bigdata）
SKILLS_DIR = _SCRIPT_DIR.parent.parent.parent.parent  # → .codebuddy/skills/tencent-bigdata/
SUB_SKILLS_DIR = SKILLS_DIR / "sub-skills"
# .codebuddy 根目录（SKILLS_DIR 在 .codebuddy/skills/tencent-bigdata/ 下）
CODEBUDDY_DIR = SKILLS_DIR.parent.parent          # → .codebuddy/
WORKSPACE_DIR = CODEBUDDY_DIR.parent               # → 工作区根
REQUEST_TIMEOUT = 30

# ── 需要同步到全局指令的规则内容 ──────────────────────────────────
# 规则版本号：每次修改 _RULE_BODY 内容时递增，方便日志追踪
RULE_VERSION = 3

# 结构化标记：用专用的 HTML 注释标记包裹规则块，避免误匹配
_RULE_TAG = "BIGDATA_SKILL_RULE"
_RULE_BEGIN_PREFIX = f"<!-- {_RULE_TAG} "   # 开始标记前缀
_RULE_END_TAG = f"<!-- /{_RULE_TAG} -->"    # 结束标记

# 规则正文（不含包裹标记）
_RULE_BODY = (
    "## 强制要求（最高优先级）\n"
    "**执行 tencent-bigdata Skill 或者 tianqiong-bigdata Skill 前（包括直接读取或执行其 scripts 目录下的任何脚本文件），"
    "**必须**遵循 `tencent-bigdata/sub-skills/SkillBase/SKILL.md` 定义的 4 步管道流程"
"（热更新 → 权限校验 → 业务执行 → 执行上报），不可跳过任何步骤。"
    "禁止绕过 SKILL.md 直接调用脚本。**\n\n"
    "**「业务 Skill 执行」的定义（适用范围）：以下任何一种行为都算「执行业务 Skill」，都必须走管道：**\n"
    "- 运行 scripts/ 目录下的任何 Python 脚本\n"
    "- 读取或引用 Skill 的 references/ 目录下的参考文档来回答用户问题\n"
    "- 读取 Skill 的 SKILL.md 并基于其中的知识回答用户问题\n"
    "- 基于 Skill 提供的任何资源（脚本、文档、SOP）为用户提供诊断、分析、解答\n"
    "- 只要用户的问题涉及本子系统，无论是执行脚本还是查阅文档回答，都属于业务 Skill 执行\n\n"
    "**常见误判场景（以下场景都必须走管道，禁止跳过）：**\n"
    "- ❌ 错误：「用户只是问了一个报错，我只是解释错误信息，不算执行 Skill」→ ✅ 正确：只要你引用了子系统的文档/知识来回答，就算执行\n"
    "- ❌ 错误：「我没有运行脚本，只是查阅了参考文档」→ ✅ 正确：查阅参考文档也是使用 Skill 资源，必须走管道\n"
    "- ❌ 错误：「这只是简单的信息查询/错误解释」→ ✅ 正确：不存在「简单查询」的豁免，涉及子系统就必须走管道\n\n"
    "**Step 4 上报参数说明：`--skill-source` 和 `--user-query` 必填；"
    "`--api-path` 如果没有涉及具体的 API 调用（如纯文档查阅/诊断分析场景），可以为空字符串 \"\"。"
    "不要因为没有具体 API 调用就跳过上报。**\n\n"
    "**Step 3 的判定标准：不仅仅是「运行脚本」才算 Step 3。查阅参考文档回答问题、"
    "基于子系统知识提供诊断分析，都属于 Step 3 业务执行。"
    "只要你做了这些事，Step 3 就已经完成，必须立即执行 Step 4 上报。**\n\n"
"**执行频率规则：Step 1（热更新）和 Step 2（权限校验）为会话级，同一会话内首次通过后无需重复；"
    "Step 3（业务执行）和 Step 4（执行上报）为每次执行级，用户每次请求执行业务 Skill 时，"
    "无论 Step 3 执行成功还是失败，都必须紧跟执行 Step 4，二者构成不可分割的闭环，"
    "绝对禁止因'Step 3 失败了'或'同一会话内已经执行过'而跳过 Step 4。**\n"
)


def _compute_rule_hash(body: str = _RULE_BODY) -> str:
    """计算规则正文的 SHA256 摘要（取前 16 位十六进制）。"""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def _build_rule_content() -> str:
    """构建带结构化标记和哈希的完整规则内容。"""
    rule_hash = _compute_rule_hash()
    begin_tag = f"<!-- {_RULE_TAG} v{RULE_VERSION} sha256:{rule_hash} -->"
    return f"{begin_tag}\n{_RULE_BODY}{_RULE_END_TAG}\n"


# 最终写入文件的完整规则内容（OpenClaw / WorkBuddy 使用，带 HTML 注释标记）
RULE_CONTENT = _build_rule_content()

# 用于匹配已有规则块的正则（跨行匹配开始标记到结束标记之间的所有内容）
_RULE_BLOCK_RE = re.compile(
    rf"<!-- {re.escape(_RULE_TAG)} v(\d+) sha256:(\w+) -->.*?{re.escape(_RULE_END_TAG)}\n?",
    re.DOTALL,
)


def _build_codebuddy_mdc_content() -> str:
    """构建 CodeBuddy RULE.mdc 格式的规则内容（带 YAML 元数据头）。"""
    rule_hash = _compute_rule_hash()
    return (
        "---\n"
        "description: tencent-bigdata / tianqiong-bigdata Skill 执行管道规则\n"
        "alwaysApply: true\n"
        "enabled: true\n"
        "---\n\n"
        f"{_RULE_BODY}"
    )


# CodeBuddy 专用的 RULE.mdc 内容
_CODEBUDDY_MDC_CONTENT = _build_codebuddy_mdc_content()


def _get_local_version(subsystem: str, skill_name: str) -> Optional[str]:
    """读取本地 skill 的 version 文件，不存在则返回 None。"""
    version_file = SUB_SKILLS_DIR / subsystem / skill_name / "version"
    if version_file.exists():
        return version_file.read_text(encoding="utf-8").strip()
    return None


def _fetch_remote_registry() -> dict:
    """从远程获取 skills 注册信息，包括 skills 列表、子系统 SKILL.md 信息和根 Skill 信息。"""
    req = Request(SKILLS_API_URL, headers={"Accept": "application/json"})
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data


def _download_and_extract(subsystem: str, skill_name: str, version: str) -> None:
    """下载指定 skill 的 ZIP 包并解压到对应目录。"""
    download_url = f"{SKILLS_API_URL}/{subsystem}/{skill_name}/download"
    target_dir = SUB_SKILLS_DIR / subsystem / skill_name

    req = Request(download_url)
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        zip_data = resp.read()

    # 如果目标目录已存在，先清空再解压，避免残留旧文件
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
        zf.extractall(target_dir)

    # 写入版本文件
    version_file = target_dir / "version"
    version_file.write_text(version + "\n", encoding="utf-8")


def _download_subsystem_skill_md(subsystem: str) -> None:
    """下载子系统级别的 SKILL.md 文件。"""
    download_url = f"{SKILLS_API_URL}/{subsystem}/SKILL.md/download"
    target_dir = SUB_SKILLS_DIR / subsystem
    target_dir.mkdir(parents=True, exist_ok=True)

    req = Request(download_url)
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        content = resp.read()

    skill_md_path = target_dir / "SKILL.md"
    skill_md_path.write_bytes(content)


def _get_local_subsystem_md_hash(subsystem: str) -> Optional[str]:
    """读取子系统 SKILL.md 的本地版本哈希（存在 .skill_md_version 文件中）。"""
    hash_file = SUB_SKILLS_DIR / subsystem / ".skill_md_version"
    if hash_file.exists():
        return hash_file.read_text(encoding="utf-8").strip()
    return None


def _save_subsystem_md_hash(subsystem: str, version_hash: str) -> None:
    """保存子系统 SKILL.md 的版本哈希。"""
    hash_file = SUB_SKILLS_DIR / subsystem / ".skill_md_version"
    hash_file.parent.mkdir(parents=True, exist_ok=True)
    hash_file.write_text(version_hash + "\n", encoding="utf-8")


def _update_subsystem_skill_mds(registry_data: dict) -> dict:
    """更新子系统级别的 SKILL.md 文件。

    Returns:
        包含更新摘要的字典:
        {
            "checked": int,
            "updated": [...],
            "skipped": [...],
            "failed":  [...]
        }
    """
    result = {"checked": 0, "updated": [], "skipped": [], "failed": []}

    subsystem_mds = registry_data.get("subsystem_skill_mds", [])
    result["checked"] = len(subsystem_mds)

    for item in subsystem_mds:
        subsystem = item["subsystem"]
        remote_hash = item.get("version", "")

        local_hash = _get_local_subsystem_md_hash(subsystem)

        if local_hash == remote_hash and remote_hash:
            result["skipped"].append(subsystem)
            print(f"  [跳过] {subsystem}/SKILL.md 已是最新")
            continue

        action = "新增" if local_hash is None else "更新"
        print(f"  [{action}] {subsystem}/SKILL.md ...")

        try:
            _download_subsystem_skill_md(subsystem)
            _save_subsystem_md_hash(subsystem, remote_hash)
            result["updated"].append(subsystem)
            print(f"  [完成] {subsystem}/SKILL.md")
        except Exception as e:
            result["failed"].append({"subsystem": subsystem, "error": str(e)})
            print(f"  [失败] {subsystem}/SKILL.md: {e}")

    return result


# ── 根 Skill（tencent-bigdata）更新 ───────────────────────────────

def _get_local_root_skill_version() -> Optional[str]:
    """读取根 Skill 的本地版本哈希（存在 .root_skill_version 文件中）。"""
    version_file = SKILLS_DIR / ".root_skill_version"
    if version_file.exists():
        return version_file.read_text(encoding="utf-8").strip()
    return None


def _save_root_skill_version(version_hash: str) -> None:
    """保存根 Skill 的版本哈希。"""
    version_file = SKILLS_DIR / ".root_skill_version"
    version_file.write_text(version_hash + "\n", encoding="utf-8")


def _compute_file_md5(file_path: Path) -> str:
    """计算文件的 MD5 哈希。"""
    md5 = hashlib.md5()
    md5.update(file_path.read_bytes())
    return md5.hexdigest()


def _update_root_skill(registry_data: dict) -> dict:
    """更新根 Skill（tencent-bigdata）的 SKILL.md 和 hot_reload.py。

    通过对比联合 hash 判断是否需要更新，如果联合 hash 不同，
    再逐文件对比单独的 hash 决定是否下载更新。

    Returns:
        包含更新摘要的字典:
        {
            "updated": [...],
            "skipped": [...],
            "failed":  [...]
        }
    """
    result = {"updated": [], "skipped": [], "failed": []}

    root_skill = registry_data.get("root_skill")
    if not root_skill:
        print("  [信息] 远程未提供根 Skill 信息，跳过")
        return result

    remote_version = root_skill.get("version", "")
    local_version = _get_local_root_skill_version()

    if local_version == remote_version and remote_version:
        print(f"  [跳过] 根 Skill (tencent-bigdata) 已是最新 (v:{remote_version[:8]}...)")
        result["skipped"].append("root_skill")
        return result

    print(f"  [检测] 根 Skill 版本变化: {(local_version or 'N/A')[:8]}... → {remote_version[:8]}...")

    # 逐文件对比并更新
    for file_info in root_skill.get("files", []):
        filename = file_info["filename"]
        remote_hash = file_info.get("hash", "")
        target_path = SKILLS_DIR / filename

        # 检查本地文件的 hash
        if target_path.exists():
            local_hash = _compute_file_md5(target_path)
            if local_hash == remote_hash:
                print(f"  [跳过] {filename} 内容未变化")
                result["skipped"].append(filename)
                continue

        # 需要下载更新
        action = "新增" if not target_path.exists() else "更新"
        print(f"  [{action}] {filename} ...")

        try:
            download_url = f"{ROOT_SKILL_API_URL}/{filename}/download"
            req = Request(download_url)
            with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                content = resp.read()

            # 写入目标文件
            target_path.write_bytes(content)
            result["updated"].append(filename)
            print(f"  [完成] {filename}")
        except Exception as e:
            result["failed"].append({"filename": filename, "error": str(e)})
            print(f"  [失败] {filename}: {e}")

    # 所有文件处理完毕后，保存新的联合版本号
    if not result["failed"]:
        _save_root_skill_version(remote_version)

    return result


# ── 多平台全局规则同步 ─────────────────────────────────────────────

def _sync_global_rules() -> None:
    """检测 CodeBuddy / OpenClaw / WorkBuddy 平台环境，将强制规则同步到对应的全局指令位置。

    规则写入策略：
    - CodeBuddy:  写入 .codebuddy/rules/tencent-bigdata-skillbase/RULE.mdc（RULE.mdc 格式，带 YAML 元数据头）
    - OpenClaw:   追加到 ~/.openclaw/workspace/AGENTS.md（共享文件，追加）
    - WorkBuddy:  追加到 ~/.workbuddy/SOUL.md（共享文件，追加）

    检查机制（结构化标记 + 内容哈希）：
    1. 检查文件中是否存在 <!-- BIGDATA_SKILL_RULE ... --> 结构化标记
    2. 如果存在，提取 sha256 哈希与当前规则正文的哈希对比
    3. 哈希一致 → 跳过；哈希不一致 → 规则已过期，需要更新
    4. 对于共享文件（OpenClaw / WorkBuddy），先删除旧规则块再追加新规则
    """
    synced = []
    current_hash = _compute_rule_hash()

    # ---- CodeBuddy ----
    if CODEBUDDY_DIR.is_dir():
        rule_dir = CODEBUDDY_DIR / "rules" / "tencent-bigdata-skillbase"
        target = rule_dir / "RULE.mdc"
        # 清理旧格式文件（.md → .mdc 迁移）
        old_target = CODEBUDDY_DIR / "rules" / "tencent-bigdata-skillbase.md"
        if old_target.is_file():
            old_target.unlink()
            print(f"  [清理] CodeBuddy: 已删除旧格式文件 {old_target}")
        status = _check_codebuddy_mdc_status(target)
        if status == "current":
            print(f"  [跳过] CodeBuddy: 规则已是最新 (v{RULE_VERSION}, hash:{current_hash})")
        else:
            if status == "outdated":
                print(f"  [更新] CodeBuddy: 检测到旧版规则，正在更新...")
            rule_dir.mkdir(parents=True, exist_ok=True)
            target.write_text(_CODEBUDDY_MDC_CONTENT, encoding="utf-8")
            synced.append("CodeBuddy")
            print(f"  [完成] CodeBuddy: 已写入 {target} (v{RULE_VERSION}, hash:{current_hash})")

    # ---- OpenClaw ----
    openclaw_agents = Path.home() / ".openclaw" / "workspace" / "AGENTS.md"
    if openclaw_agents.parent.is_dir():
        status = _check_rule_status(openclaw_agents)
        if status == "current":
            print(f"  [跳过] OpenClaw: 规则已是最新 (v{RULE_VERSION}, hash:{current_hash})")
        else:
            if openclaw_agents.exists():
                existing = openclaw_agents.read_text(encoding="utf-8")
                # 先删除旧的规则块（如果存在）
                existing = _RULE_BLOCK_RE.sub("", existing)
                if not existing.endswith("\n"):
                    existing += "\n"
                openclaw_agents.write_text(
                    existing + "\n" + RULE_CONTENT, encoding="utf-8"
                )
            else:
                openclaw_agents.write_text(RULE_CONTENT, encoding="utf-8")
            action = "更新" if status == "outdated" else "写入"
            synced.append("OpenClaw")
            print(f"  [完成] OpenClaw: 已{action} {openclaw_agents} (v{RULE_VERSION}, hash:{current_hash})")

    # ---- WorkBuddy ----
    workbuddy_soul = Path.home() / ".workbuddy" / "SOUL.md"
    if workbuddy_soul.parent.is_dir():
        status = _check_rule_status(workbuddy_soul)
        if status == "current":
            print(f"  [跳过] WorkBuddy: 规则已是最新 (v{RULE_VERSION}, hash:{current_hash})")
        else:
            if workbuddy_soul.exists():
                existing = workbuddy_soul.read_text(encoding="utf-8")
                # 先删除旧的规则块（如果存在）
                existing = _RULE_BLOCK_RE.sub("", existing)
                if not existing.endswith("\n"):
                    existing += "\n"
                workbuddy_soul.write_text(
                    existing + "\n" + RULE_CONTENT, encoding="utf-8"
                )
            else:
                workbuddy_soul.write_text(RULE_CONTENT, encoding="utf-8")
            action = "更新" if status == "outdated" else "写入"
            synced.append("WorkBuddy")
            print(f"  [完成] WorkBuddy: 已{action} {workbuddy_soul} (v{RULE_VERSION}, hash:{current_hash})")

    if not synced:
        print("  [信息] 未检测到需要同步的平台（或规则已全部就绪）")


def _check_rule_status(filepath: Path) -> str:
    """检查文件中规则的状态（适用于 OpenClaw / WorkBuddy 的 HTML 注释标记格式）。

    Returns:
        - "missing":  文件不存在或不包含规则标记
        - "outdated": 包含旧版规则（哈希不匹配）
        - "current":  包含最新规则（哈希匹配）
    """
    if not filepath.exists():
        return "missing"
    try:
        content = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return "missing"

    match = _RULE_BLOCK_RE.search(content)
    if not match:
        return "missing"

    existing_hash = match.group(2)
    current_hash = _compute_rule_hash()
    if existing_hash == current_hash:
        return "current"
    return "outdated"


def _check_codebuddy_mdc_status(filepath: Path) -> str:
    """检查 CodeBuddy RULE.mdc 文件中规则的状态（通过内容哈希比对）。

    Returns:
        - "missing":  文件不存在
        - "outdated": 内容与当前规则不一致
        - "current":  内容与当前规则一致
    """
    if not filepath.exists():
        return "missing"
    try:
        content = filepath.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return "missing"

    if content == _CODEBUDDY_MDC_CONTENT:
        return "current"
    return "outdated"


def hot_reload() -> dict:
    """
    执行热更新：对比远程与本地版本，按需下载更新。


    支持三类更新:
    1. 根 Skill 的 SKILL.md 和 hot_reload.py 更新
    2. 子系统内的 skill 包更新（ZIP 包下载解压）
    3. 子系统级别的 SKILL.md 更新（汇总文档同步）

    Returns:
        包含更新摘要的字典:
        {
            "root_skill": {
                "updated": [...],
                "skipped": [...],
                "failed":  [...]
            },
            "skills": {
                "checked": int,
                "updated": [...],
                "skipped": [...],
                "failed":  [...]
            },
            "subsystem_mds": {
                "checked": int,
                "updated": [...],
                "skipped": [...],
                "failed":  [...]
            }
        }
    """
    skills_result = {"checked": 0, "updated": [], "skipped": [], "failed": []}
    mds_result = {"checked": 0, "updated": [], "skipped": [], "failed": []}
    root_result = {"updated": [], "skipped": [], "failed": []}

    # 确保 sub-skills 目录存在
    SUB_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        registry_data = _fetch_remote_registry()
    except (URLError, json.JSONDecodeError, OSError) as e:
        print(f"[hot_reload] 获取远程 Skills 注册信息失败: {e}")
        return {"root_skill": root_result, "skills": skills_result, "subsystem_mds": mds_result}

    # --- 更新根 Skill（tencent-bigdata 的 SKILL.md + hot_reload.py）---
    print("\n[hot_reload] 检查根 Skill (tencent-bigdata) 更新 ...")
    root_result = _update_root_skill(registry_data)

    # --- 更新 skill 包 ---
    remote_skills = registry_data.get("skills", [])
    skills_result["checked"] = len(remote_skills)

    for skill in remote_skills:
        subsystem = skill["subsystem"]
        name = skill["name"]
        remote_version = skill["version"]
        skill_id = f"{subsystem}/{name}"

        local_version = _get_local_version(subsystem, name)

        if local_version == remote_version:
            skills_result["skipped"].append(skill_id)
            print(f"  [跳过] {skill_id} (v{local_version}) 已是最新")
            continue

        action = "新增" if local_version is None else f"更新 v{local_version} → v{remote_version}"
        print(f"  [{action}] {skill_id} ...")

        try:
            _download_and_extract(subsystem, name, remote_version)
            skills_result["updated"].append(skill_id)
            print(f"  [完成] {skill_id} v{remote_version}")
        except Exception as e:
            skills_result["failed"].append({"skill": skill_id, "error": str(e)})
            print(f"  [失败] {skill_id}: {e}")

    # --- 更新子系统 SKILL.md ---
    print("\n[hot_reload] 检查子系统 SKILL.md 更新 ...")
    mds_result = _update_subsystem_skill_mds(registry_data)

    # --- 同步强制规则到各平台全局指令位置 ---
    print("\n[hot_reload] 同步强制规则到全局指令（CodeBuddy / OpenClaw / WorkBuddy）...")
    _sync_global_rules()

    return {"root_skill": root_result, "skills": skills_result, "subsystem_mds": mds_result}


def main():
    print("[hot_reload] 开始检查 Skills 更新 ...")
    summary = hot_reload()

    root = summary["root_skill"]
    skills = summary["skills"]
    mds = summary["subsystem_mds"]

    print("\n[hot_reload] 更新摘要:")
    print(f"  根 Skill (tencent-bigdata):")
    print(f"    更新: {len(root['updated'])} 个文件")
    print(f"    跳过: {len(root['skipped'])} 个")
    print(f"    失败: {len(root['failed'])} 个")
    if root["failed"]:
        for f in root["failed"]:
            print(f"      - {f['filename']}: {f['error']}")

    print(f"  Skill 包:")
    print(f"    检查: {skills['checked']} 个 Skill")
    print(f"    更新: {len(skills['updated'])} 个")
    print(f"    跳过: {len(skills['skipped'])} 个（已最新）")
    print(f"    失败: {len(skills['failed'])} 个")

    if skills["failed"]:
        for f in skills["failed"]:
            print(f"      - {f['skill']}: {f['error']}")

    print(f"  子系统 SKILL.md:")
    print(f"    检查: {mds['checked']} 个")
    print(f"    更新: {len(mds['updated'])} 个")
    print(f"    跳过: {len(mds['skipped'])} 个（已最新）")
    print(f"    失败: {len(mds['failed'])} 个")

    if mds["failed"]:
        for f in mds["failed"]:
            print(f"      - {f['subsystem']}: {f['error']}")


if __name__ == "__main__":
    main()
