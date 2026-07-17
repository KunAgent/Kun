#!/usr/bin/env python3
"""
tencent-tab Skills 热加载脚本。

每次执行 Skill 前调用，自动从远程 Skills Manager 检查并更新本地 Skills。
支持根目录文件更新和 sub-skills 目录结构增量更新。

用法:
    python3 hot_reload.py
"""

import io
import json
import shutil
import sys
import zipfile
from pathlib import Path
from typing import Optional, TypedDict
from urllib.parse import urlparse, urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError

SKILLS_DIR = Path(__file__).resolve().parent
ENV_CONFIG_PATH = SKILLS_DIR / "env_config.json"


def _load_env_config() -> dict:
    """读取 env_config.json，返回配置字典；文件不存在或解析失败则返回空字典。"""
    if ENV_CONFIG_PATH.exists():
        try:
            return json.loads(ENV_CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


# 可信域名白名单，URL 的 host 必须在此列表内，否则拒绝执行
ALLOWED_HOSTS = ["skills.tab.woa.com","tab-skills.testsite.woa.com"]


def _validate_url(url: str) -> None:
    """校验 URL 的 host 必须在白名单内，否则抛出 ValueError。"""
    host = urlparse(url).hostname or ""
    if host not in ALLOWED_HOSTS:
        raise ValueError(
            f"[hot_reload] 拒绝执行：URL host '{host}' 不在可信白名单 {ALLOWED_HOSTS} 内"
        )


def _resolve_skills_base_url() -> str:
    """从 env_config.json 顶层 skills_base_url 字段读取（所有环境共用同一地址）。

    仅信任本地 env_config.json，不接受环境变量覆盖，防止外部注入攻击。
    """
    config = _load_env_config()
    url = config.get("skills_base_url", "http://skills.tab.woa.com/api/skills")
    _validate_url(url)
    return url


SKILLS_BASE_URL = _resolve_skills_base_url()
# 从 env_config.json 读取 env 字段，用于请求服务端时区分环境目录
ENV_NAME = _load_env_config().get("env", "")
SUB_SKILLS_DIR = SKILLS_DIR / "sub-skills"
REQUEST_TIMEOUT = 30


def _url_with_env(base_url: str) -> str:
    """为 URL 附加 ?env=xxx 查询参数（仅当 ENV_NAME 非空时）。"""
    if not ENV_NAME:
        return base_url
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}{urlencode({'env': ENV_NAME})}"

# 根目录需要同步的文件列表
ROOT_FILES = ["hot_reload.py", "SKILL.md", "env_config.json", "auth_setup.py", "check_deps.py","version"]


# --- 返回值类型定义 ---

class RootResult(TypedDict):
    updated: list
    failed: list


class SkillsResult(TypedDict):
    checked: int
    updated: list
    skipped_count: int
    failed: list
    removed: list


class HotReloadResult(TypedDict):
    root: RootResult
    skills: SkillsResult


# --- 工具函数 ---

def _read_version(path: Path) -> Optional[str]:
    """读取指定路径的 version 文件，不存在则返回 None。"""
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return None


def _fetch_remote_registry() -> dict:
    """从远程获取 skills 注册信息，包括 root_version 和 skills 列表。"""
    url = _url_with_env(SKILLS_BASE_URL)
    req = Request(url, headers={"Accept": "application/json"})
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data


def _download_root_file(filename: str) -> None:
    """下载根目录指定文件并覆盖本地对应文件。

    对 env_config.json 特殊处理：保留本地用户自定义字段（env、auth），不被远程覆盖。
    """
    download_url = _url_with_env(f"{SKILLS_BASE_URL}/root/{filename}/download")
    target_path = SKILLS_DIR / filename

    req = Request(download_url)
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        content = resp.read()

    if filename == "env_config.json":
        # 保留本地用户选择的字段，不被远程内容覆盖（包括空字符串也需保留）
        local_cfg = _load_env_config()
        preserve_keys = ("env", "business_code", "auth")
        local_values = {k: local_cfg[k] for k in preserve_keys if k in local_cfg}
        target_path.write_bytes(content)
        if local_values:
            try:
                cfg = json.loads(target_path.read_text(encoding="utf-8"))
                cfg.update(local_values)
                target_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            except Exception:
                pass  # 还原失败不影响整体流程
    else:
        target_path.write_bytes(content)


def _download_and_extract(subsystem: str, skill_name: str) -> None:
    """下载指定 skill 的 ZIP 包并解压到对应目录。

    version 文件直接使用 ZIP 包内的版本，不由外部写入。
    """
    download_url = _url_with_env(f"{SKILLS_BASE_URL}/{subsystem}/{skill_name}/download")
    target_dir = SUB_SKILLS_DIR / subsystem / skill_name

    req = Request(download_url)
    with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        zip_data = resp.read()

    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            zf.extractall(target_dir)
    except Exception:
        shutil.rmtree(target_dir, ignore_errors=True)
        raise


def _update_root_files() -> RootResult:
    """更新根目录文件（hot_reload.py、SKILL.md、version）。

    version 文件最后写入，且仅在其他文件全部成功后才更新，
    以避免 version 已更新但其他文件未更新导致后续跳过更新的问题。
    """
    result: RootResult = {"updated": [], "failed": []}

    # 先更新非 version 文件
    non_version_files = [f for f in ROOT_FILES if f != "version"]
    for filename in non_version_files:
        print(f"[hot_reload] 更新根目录文件 {filename}", file=sys.stderr)
        try:
            _download_root_file(filename)
            result["updated"].append(filename)
            print(f"[hot_reload] 完成 {filename}", file=sys.stderr)
        except Exception as e:
            result["failed"].append({"file": filename, "error": str(e)})
            print(f"[hot_reload] 失败 {filename}: {e}", file=sys.stderr)

    # 仅在其他文件全部成功时才更新 version（作为提交点）
    if result["failed"]:
        print("[hot_reload] 跳过 version（存在失败文件，保留旧版本以便下次重试）", file=sys.stderr)
    else:
        print("[hot_reload] 更新根目录文件 version", file=sys.stderr)
        try:
            _download_root_file("version")
            result["updated"].append("version")
            print("[hot_reload] 完成 version", file=sys.stderr)
        except Exception as e:
            result["failed"].append({"file": "version", "error": str(e)})
            print(f"[hot_reload] 失败 version: {e}", file=sys.stderr)

    return result


def _remove_local_deprecated(remote_skills: list) -> list:
    """删除本地存在但不在远程列表中的子技能目录，返回已删除的 skill_id 列表。

    以远程列表为唯一事实来源：凡是本地 sub-skills/ 下存在、却不在远程列表里的目录，
    一律视为已废弃并删除。子系统目录整体不在远程列表中时，直接整体删除。
    """
    if not SUB_SKILLS_DIR.exists():
        return []

    remote_set = {(s["subsystem"], s["name"]) for s in remote_skills}
    remote_subsystems = {s["subsystem"] for s in remote_skills}
    removed = []

    def _rmtree(path: Path, label: str) -> bool:
        print(f"[hot_reload] 删除废弃 {label}", file=sys.stderr)
        try:
            shutil.rmtree(path)
            removed.append(label)
            print(f"[hot_reload] 完成删除 {label}", file=sys.stderr)
            return True
        except Exception as e:
            print(f"[hot_reload] 删除失败 {label}: {e}", file=sys.stderr)
            return False

    for subsystem_dir in SUB_SKILLS_DIR.iterdir():
        if not subsystem_dir.is_dir():
            continue
        if subsystem_dir.name not in remote_subsystems:
            _rmtree(subsystem_dir, subsystem_dir.name)
            continue
        for skill_dir in subsystem_dir.iterdir():
            if skill_dir.is_dir() and (subsystem_dir.name, skill_dir.name) not in remote_set:
                _rmtree(skill_dir, f"{subsystem_dir.name}/{skill_dir.name}")

    return removed


def hot_reload() -> HotReloadResult:
    """执行热加载：对比远程与本地版本，按需下载更新，并清理已废弃的子技能。

    流程:
    1. 请求远程 skills 元数据（GET /api/skills）
    2. 读取本地 root version 文件
    3. 对比 root_version:
       - 不一致 → 更新根目录文件（hot_reload.py、SKILL.md 等）
       - 一致   → 检查 ROOT_FILES 中是否有本地缺失的文件，若有则补全下载；否则跳过根目录更新
    4. 遍历 skills 列表，对比各 skill 本地 version，版本不同则下载 ZIP 更新
    5. 删除本地存在但不在远程列表中的子技能目录（以远程列表为唯一事实来源）
    """
    root_result: RootResult = {"updated": [], "failed": []}
    skills_result: SkillsResult = {"checked": 0, "updated": [], "skipped_count": 0, "failed": [], "removed": []}

    SUB_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        registry_data = _fetch_remote_registry()
    except (URLError, json.JSONDecodeError, OSError) as e:
        print(f"[hot_reload] 获取远程 Skills 注册信息失败: {e}", file=sys.stderr)
        return {"root": root_result, "skills": skills_result}

    # --- 对比 root_version，决定是否更新根目录文件 ---
    remote_root_version = registry_data.get("root_version", "")
    local_root_version = _read_version(SKILLS_DIR / "version")

    if local_root_version != remote_root_version:
        action = "初始化" if local_root_version is None else f"v{local_root_version} -> v{remote_root_version}"
        print(f"[hot_reload] 根目录版本变更（{action}），更新根目录文件", file=sys.stderr)
        root_result = _update_root_files()
    else:
        # 版本号相同时，仍需检查是否有文件缺失（例如上次热加载时 ROOT_FILES 不含该文件导致遗漏）
        missing_files = [f for f in ROOT_FILES if f != "version" and not (SKILLS_DIR / f).exists()]
        if missing_files:
            print(f"[hot_reload] 根目录版本 v{local_root_version} 相同，但发现缺失文件 {missing_files}，补全下载", file=sys.stderr)
            for filename in missing_files:
                print(f"[hot_reload] 补全根目录文件 {filename}", file=sys.stderr)
                try:
                    _download_root_file(filename)
                    root_result["updated"].append(filename)
                    print(f"[hot_reload] 完成 {filename}", file=sys.stderr)
                except Exception as e:
                    root_result["failed"].append({"file": filename, "error": str(e)})
                    print(f"[hot_reload] 失败 {filename}: {e}", file=sys.stderr)
        else:
            print(f"[hot_reload] 根目录版本 v{local_root_version} 已是最新，跳过根目录更新", file=sys.stderr)

    # --- 遍历 skills 列表，增量更新 sub-skills ---
    print("[hot_reload] 检查 sub-skills 更新", file=sys.stderr)
    remote_skills = registry_data.get("skills", [])
    skills_result["checked"] = len(remote_skills)

    for skill in remote_skills:
        subsystem = skill["subsystem"]
        name = skill["name"]
        remote_version = skill["version"]
        skill_id = f"{subsystem}/{name}"

        local_version = _read_version(SUB_SKILLS_DIR / subsystem / name / "version")

        if local_version == remote_version:
            skills_result["skipped_count"] += 1
            print(f"[hot_reload] 跳过 {skill_id} (v{local_version}) 已是最新", file=sys.stderr)
            continue

        action = "新增" if local_version is None else f"更新 v{local_version} -> v{remote_version}"
        print(f"[hot_reload] {action} {skill_id}", file=sys.stderr)

        try:
            _download_and_extract(subsystem, name)
            skills_result["updated"].append(skill_id)
            print(f"[hot_reload] 完成 {skill_id} v{remote_version}", file=sys.stderr)
        except Exception as e:
            skills_result["failed"].append({"skill": skill_id, "error": str(e)})
            print(f"[hot_reload] 失败 {skill_id}: {e}", file=sys.stderr)

    # --- 清理废弃子技能：删除本地有但远程列表没有的目录 ---
    print("[hot_reload] 检查废弃子技能", file=sys.stderr)
    skills_result["removed"] = _remove_local_deprecated(remote_skills)

    return {"root": root_result, "skills": skills_result}


def main():
    print("[hot_reload] 开始检查 Skills 更新", file=sys.stderr)
    summary = hot_reload()

    root = summary["root"]
    skills = summary["skills"]

    # 若 SKILL.md 已更新，在 stderr 提示 agent 重新读取
    if "SKILL.md" in root["updated"]:
        skill_md_path = SKILLS_DIR / "SKILL.md"
        print(f"[hot_reload] SKILL.md 已更新，请立即重新读取根 Skill 文件: {skill_md_path}", file=sys.stderr)

    # 若有废弃技能被删除，提示 agent
    if skills.get("removed"):
        print(f"[hot_reload] 已删除废弃子技能: {skills['removed']}，请勿再引用这些技能", file=sys.stderr)

    # 最终摘要以 JSON 输出到 stdout，供 agent 解析
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
