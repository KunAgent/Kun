#!/usr/bin/env python3
"""
天穹大数据 Skills 热加载脚本。

每次执行 Skill 前调用，自动从远程 Skills Manager 检查并更新本地 Skills。
支持 sub-skills 目录结构和子系统级 SKILL.md 更新。

用法:
    python3 hot_reload.py
"""

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import URLError
from urllib.request import Request, urlopen

# ── 本地配置文件 ─────────────────────────────────────────────────
# 配置文件路径：~/.do-bigdata/config.json
# 支持的配置项：
#   skills_base_url  — Skills Manager API 地址（用于切换测试/生产环境）
#   update_check_ttl — 更新检查 TTL 缓存时间（秒）
_CONFIG_DIR = Path.home() / ".do-bigdata"
_CONFIG_FILE = _CONFIG_DIR / "config.json"

_DEFAULT_SKILLS_BASE_URL = "http://bigdata-do-skills-manager.woa.com/api"
_DEFAULT_UPDATE_CHECK_TTL = 86400  # 默认 1 day


def _load_local_config() -> dict:
    """从 ~/.do-bigdata/config.json 读取本地配置。

    文件不存在或解析失败时返回空字典，不影响正常运行。
    """
    try:
        if _CONFIG_FILE.exists():
            return json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pass
    return {}


_local_config = _load_local_config()

SKILLS_BASE_URL = _local_config.get("skills_base_url", _DEFAULT_SKILLS_BASE_URL)
SKILLS_API_URL = f"{SKILLS_BASE_URL}/skills"
ROOT_SKILL_API_URL = f"{SKILLS_BASE_URL}/root-skill"
CLI_API_URL = f"{SKILLS_BASE_URL}/cli"

# ── TTL 缓存配置 ─────────────────────────────────────────────────
# 缓存有效期：默认 1 天（86400 秒），可通过 config.json 的 update_check_ttl 覆盖
UPDATE_CHECK_TTL = int(_local_config.get("update_check_ttl", _DEFAULT_UPDATE_CHECK_TTL))
# 缓存文件路径：~/.do-bigdata/.update_check_cache
_UPDATE_CACHE_FILE = _CONFIG_DIR / ".update_check_cache"

SKILLS_DIR = Path(__file__).resolve().parent
SUB_SKILLS_DIR = SKILLS_DIR / "sub-skills"
CODEBUDDY_DIR = SKILLS_DIR.parent.parent          # → .codebuddy/
WORKSPACE_DIR = CODEBUDDY_DIR.parent               # → 工作区根
REQUEST_TIMEOUT = 30


def _persist_skills_dir() -> None:
    """把 SKILLS_DIR 持久化到 ~/.do-bigdata/config.json 的 skills_dir 字段。

    这是 CLI 定位 Skills 根目录的**唯一**权威来源。CLI 启动时会从 config.json
    读取 skills_dir 并自愈到当前进程的环境变量中，下游 middleware/auth 等模块
    完全无需感知该字段的来源。

    设计原则：
    - 不再向 shell 导出 DO_BIGDATA_SKILLS_DIR 环境变量（env 在新 shell 失效，
      会让 AI 反复踩坑）；改为单一存储到 config.json，跨 shell / 跨会话生效。
    - 仅在值发生变化时写盘，避免无谓 IO；写失败静默忽略，不影响主流程。
    """
    try:
        _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        cfg = {}
        if _CONFIG_FILE.exists():
            try:
                cfg = json.loads(_CONFIG_FILE.read_text(encoding="utf-8")) or {}
            except (json.JSONDecodeError, OSError):
                cfg = {}
        new_val = str(SKILLS_DIR)
        if cfg.get("skills_dir") == new_val:
            return
        cfg["skills_dir"] = new_val
        _CONFIG_FILE.write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


_persist_skills_dir()

# ── 需要同步到全局指令的规则内容 ──────────────────────────────────
# 规则版本号：每次修改 _RULE_BODY 内容时递增，方便日志追踪
RULE_VERSION = 6

# 结构化标记：用专用的 HTML 注释标记包裹规则块，避免误匹配
_RULE_TAG = "BIGDATA_SKILL_RULE"
_RULE_BEGIN_PREFIX = f"<!-- {_RULE_TAG} "   # 开始标记前缀
_RULE_END_TAG = f"<!-- /{_RULE_TAG} -->"    # 结束标记

# 规则正文（不含包裹标记）
_RULE_BODY = (
    "## 强制要求（最高优先级）\n"
    "**执行 tencent-bigdata Skill 或者 tianqiong-bigdata Skill 时，"
    "禁止根据上下文直接调用 `do-bigdata` 的 CLI 子命令，"
    "必须先阅读对应 Skill 的文档（SKILL.md），"
    "按照文档中的说明和步骤执行，避免出现执行逻辑混乱。**\n"
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
    return (
        "---\n"
        "description: tencent-bigdata / tianqiong-bigdata Skill CLI 调用规则\n"
        "alwaysApply: true\n"
        "enabled: true\n"
        "---\n\n"
        f"{_RULE_BODY}"
    )


# CodeBuddy 专用的 RULE.mdc 内容
_CODEBUDDY_MDC_CONTENT = _build_codebuddy_mdc_content()


# ── TTL 缓存读写 ─────────────────────────────────────────────────

def _is_cache_valid() -> bool:
    """判断本地 TTL 缓存是否仍然有效（未过期）。

    Returns:
        True: 缓存存在且未过期，可跳过网络检查
        False: 缓存不存在、已过期或读取失败，需要执行网络检查
    """
    if not _UPDATE_CACHE_FILE.exists():
        return False
    try:
        cache = json.loads(_UPDATE_CACHE_FILE.read_text(encoding="utf-8"))
        last_check = cache.get("last_check_ts", 0)
        return (time.time() - last_check) < UPDATE_CHECK_TTL
    except (json.JSONDecodeError, OSError, ValueError):
        return False


def _refresh_cache() -> None:
    """刷新缓存文件，记录当前时间戳。"""
    try:
        _UPDATE_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _UPDATE_CACHE_FILE.write_text(
            json.dumps({"last_check_ts": int(time.time())}),
            encoding="utf-8",
        )
    except OSError:
        pass  # 缓存写入失败不影响主流程


def _get_local_version(subsystem, skill_name):
    # type: (str, str) -> Optional[str]
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
        file_list = zf.namelist()
        # 安全解压：逐文件检查路径遍历攻击（防止 ../../ 等恶意文件名）
        for member in zf.infolist():
            member_path = (target_dir / member.filename).resolve()
            # 确保解压后的文件路径在目标目录内
            if not str(member_path).startswith(str(target_dir.resolve()) + os.sep) and member_path != target_dir.resolve():
                raise ValueError(
                    f"ZIP 包含非法路径遍历文件名: {member.filename}，已拒绝解压"
                )
            zf.extract(member, target_dir)

    # 写入版本文件
    version_file = target_dir / "version"
    version_file.write_text(version + "\n", encoding="utf-8")

    # 输出解压文件摘要（按类别统计）
    ref_files = [f for f in file_list if f.startswith("references/")]
    script_files = [f for f in file_list if f.startswith("scripts/")]
    rule_files = [f for f in file_list if f.startswith("rules/")]
    other_files = [f for f in file_list if not f.startswith(("references/", "scripts/", "rules/")) and not f.endswith("/")]

    total = len([f for f in file_list if not f.endswith("/")])
    print(f"    解压 {total} 个文件", end="")
    parts = []
    if ref_files:
        parts.append(f"{len(ref_files)} 个 references")
    if script_files:
        parts.append(f"{len(script_files)} 个 scripts")
    if rule_files:
        parts.append(f"{len(rule_files)} 个 rules")
    if other_files:
        parts.append(f"{len(other_files)} 个其他文件")
    if parts:
        print(f"（{', '.join(parts)}）")
    else:
        print()

    # 逐个列出 references 文件
    for ref in sorted(ref_files):
        print(f"      [FILE] {ref}")


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


def _get_local_subsystem_md_hash(subsystem):
    # type: (str,) -> Optional[str]
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
    result = {"checked": 0, "updated": [], "skipped": [], "failed": []}  # type: Dict[str, Any]

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

def _get_local_root_skill_version():
    # type: () -> Optional[str]
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
    """更新根 Skill（tencent-bigdata）的 SKILL.md、hot_reload.py 和 references/ 目录。

    通过对比联合 hash 判断是否需要更新，如果联合 hash 不同，
    再逐文件对比单独的 hash 决定是否下载更新。
    更新完成后会清理本地 references/ 中不在远程列表中的多余文件。

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

            # 确保父目录存在（支持 references/catalogs/ 等子目录）
            target_path.parent.mkdir(parents=True, exist_ok=True)
            # 写入目标文件
            target_path.write_bytes(content)
            result["updated"].append(filename)
            print(f"  [完成] {filename}")
        except Exception as e:
            result["failed"].append({"filename": filename, "error": str(e)})
            print(f"  [失败] {filename}: {e}")

    # 清理本地 references/ 中不在远程列表中的多余文件
    _cleanup_stale_references(root_skill)

    # 所有文件处理完毕后，保存新的联合版本号
    if not result["failed"]:
        _save_root_skill_version(remote_version)

    return result


def _cleanup_stale_references(root_skill: dict) -> None:
    """清理本地 references/ 目录中不在远程文件列表中的多余文件。

    当远程删除了某个 references 文件时，本地也应同步删除，
    避免本地残留过期的参考文档。
    """
    remote_ref_files = {
        f["filename"] for f in root_skill.get("files", [])
        if f["filename"].startswith("references/")
    }
    local_ref_dir = SKILLS_DIR / "references"
    if not local_ref_dir.exists():
        return

    for local_file in local_ref_dir.rglob("*"):
        if local_file.is_file():
            # 统一使用正斜杠，确保 Windows 下 relative_to 生成的反斜杠路径能与远程列表匹配
            rel_path = str(local_file.relative_to(SKILLS_DIR)).replace("\\", "/")
            if rel_path not in remote_ref_files:
                try:
                    local_file.unlink()
                    print(f"  [清理] 删除本地多余文件: {rel_path}")
                except OSError as e:
                    print(f"  [警告] 清理文件失败 {rel_path}: {e}")

    # 清理空目录
    for dirpath in sorted(local_ref_dir.rglob("*"), reverse=True):
        if dirpath.is_dir():
            try:
                dirpath.rmdir()  # 仅删除空目录
                print(f"  [清理] 删除空目录: {dirpath.relative_to(SKILLS_DIR)}")
            except OSError:
                pass  # 目录非空，跳过


# ── CLI 自动安装/更新 ─────────────────────────────────────────────

def _find_cli_bin_path(auto_fix_path: bool = True) -> Optional[str]:
    """查找 do-bigdata CLI 的可执行文件绝对路径（跨平台）。

    查找策略（按优先级）：
    1. shutil.which — PATH 中直接可用（Windows 下自动带 .exe 后缀）
    2. pip show Location 推断 bin/Scripts 目录 — 适用于 --user 安装
    3. 常见 bin/Scripts 目录探测 — Linux / macOS / Windows 覆盖

    平台差异：
      - POSIX：可执行文件名为 do-bigdata，目录名为 bin/
      - Windows：可执行文件名为 do-bigdata.exe，目录名为 Scripts/

    如果通过 2/3 找到了但 which 找不到，会自动将目录加入
    当前进程的 PATH 环境变量（auto_fix_path=True 时）。注意：此修复仅对
    当前 Python 进程生效，不会持久化到用户 shell/注册表。

    Returns:
        CLI 可执行文件的绝对路径，找不到则返回 None。
    """
    is_windows = (os.name == "nt")
    exe_name = "do-bigdata.exe" if is_windows else "do-bigdata"
    bin_dirname = "Scripts" if is_windows else "bin"

    # 策略 1：PATH 中直接可用
    # Windows 下 shutil.which 会自动尝试 PATHEXT，传 "do-bigdata" 即可匹配 .exe
    path = shutil.which("do-bigdata")
    if path:
        return path

    # 策略 2：通过 pip show 的 Location 推断 bin/Scripts 目录
    # pip --user 安装时，Location 通常是 .../lib/pythonX.Y/site-packages（POSIX）
    # 或 ...\PythonXYZ\Lib\site-packages（Windows）
    # 对应的可执行目录在 .../bin/（POSIX）或 ...\Scripts\（Windows）
    found_bin_path = None
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "show", "do-bigdata"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, timeout=15,
        )
        if result.returncode == 0:
            location = ""
            for line in result.stdout.splitlines():
                if line.startswith("Location:"):
                    location = line.split(":", 1)[1].strip()
                    break
            if location:
                # 向上遍历，找到包含 {bin_dirname}/{exe_name} 的父目录
                # POSIX 示例: /Users/xxx/Library/Python/3.9/lib/python/site-packages
                #   → /Users/xxx/Library/Python/3.9/bin/do-bigdata
                # Windows 示例: C:\Users\xxx\AppData\Local\Programs\Python\Python312\Lib\site-packages
                #   → C:\Users\xxx\AppData\Local\Programs\Python\Python312\Scripts\do-bigdata.exe
                loc_path = Path(location)
                for parent in [loc_path] + list(loc_path.parents):
                    candidate = parent / bin_dirname / exe_name
                    if candidate.exists():
                        # POSIX 下需要可执行权限；Windows 下 .exe 本身可执行
                        if is_windows or os.access(str(candidate), os.X_OK):
                            found_bin_path = str(candidate.resolve())
                            break
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass

    # 策略 3：探测常见可执行目录
    if not found_bin_path:
        home = Path.home()
        common_bin_dirs = []

        if is_windows:
            # Windows --user 安装：%APPDATA%\Python\PythonXYZ\Scripts
            appdata = os.environ.get("APPDATA", "")
            if appdata:
                appdata_py = Path(appdata) / "Python"
                if appdata_py.exists():
                    try:
                        for ver_dir in sorted(appdata_py.iterdir(), reverse=True):
                            if ver_dir.is_dir() and ver_dir.name.lower().startswith("python"):
                                common_bin_dirs.append(ver_dir / "Scripts")
                    except OSError:
                        pass
            # 全局安装：当前解释器目录下的 Scripts/（sys.executable 在 PythonXYZ\python.exe）
            python_dir = Path(sys.executable).resolve().parent
            common_bin_dirs.append(python_dir / "Scripts")
            # 某些 venv 布局：可执行文件直接和 python.exe 同目录
            common_bin_dirs.append(python_dir)
        else:
            # POSIX 常见路径
            common_bin_dirs.extend([
                home / ".local" / "bin",   # Linux pip --user
                home / "bin",              # 部分 Linux 发行版
            ])
            # macOS: ~/Library/Python/X.Y/bin/
            mac_python_lib = home / "Library" / "Python"
            if mac_python_lib.exists():
                try:
                    for ver_dir in sorted(mac_python_lib.iterdir(), reverse=True):
                        if ver_dir.is_dir():
                            common_bin_dirs.append(ver_dir / "bin")
                except OSError:
                    pass
            # 当前 Python 解释器对应的 bin 目录
            python_bin = Path(sys.executable).resolve().parent
            common_bin_dirs.append(python_bin)

        for bin_dir in common_bin_dirs:
            candidate = bin_dir / exe_name
            if candidate.exists():
                if is_windows or os.access(str(candidate), os.X_OK):
                    found_bin_path = str(candidate.resolve())
                    break

    # 如果通过策略 2/3 找到了，自动修复 PATH（仅当前进程生效）
    if found_bin_path and auto_fix_path:
        bin_dir = str(Path(found_bin_path).parent)
        current_path = os.environ.get("PATH", "")
        # Windows PATH 比较大小写不敏感
        path_parts = current_path.split(os.pathsep)
        if is_windows:
            already_in = any(p.lower() == bin_dir.lower() for p in path_parts)
        else:
            already_in = bin_dir in path_parts
        if not already_in:
            os.environ["PATH"] = bin_dir + os.pathsep + current_path
            print(f"  [PATH 修复] 已将 {bin_dir} 加入当前进程 PATH")

    return found_bin_path


def _emit_path_hint_if_needed(bin_dir: str) -> None:
    """若 do-bigdata 不在默认 PATH 中，按当前平台输出重新打开终端后仍可用的持久化指令。

    设计原则：
      - 不自动修改用户的系统 PATH（setx / 注册表 / shell rc），避免对用户环境做持久性写入。
      - 在输出中直接给出可复制粘贴的指令，用户/AI 自行决定是否执行。
      - Windows 同时给出两种指令：当前会话的临时生效 + 持久化到用户 PATH。

    判断“是否需要提示”的逻辑：
      _find_cli_bin_path 会将 bin_dir 注入当前进程的 os.environ["PATH"]，
      所以 shutil.which 在本进程中能命中；但用户下次开的新 shell 继承的是
      “永久 PATH”，所以必须提示。这里考虑到 os.environ 已经被修改，
      先无条件提示，交由用户自行判断是否已持久化。
    """
    is_windows = (os.name == "nt")
    print(f"[hot_reload] [WARN] do-bigdata 可执行文件位于: {bin_dir}")
    print(f"[hot_reload] [PATH] 若新开终端找不到 do-bigdata 命令，请将上述目录加入 PATH：")
    if is_windows:
        print(f"[hot_reload]   [临时生效] PowerShell:")
        print(f'[hot_reload]     $env:PATH = "{bin_dir};" + $env:PATH')
        print(f"[hot_reload]   [临时生效] cmd:")
        print(f'[hot_reload]     set PATH={bin_dir};%PATH%')
        print(f"[hot_reload]   [持久化到用户 PATH，需重开终端生效]:")
        print(f'[hot_reload]     PowerShell: [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";{bin_dir}", "User")')
        print(f'[hot_reload]     或 cmd:   setx PATH "%PATH%;{bin_dir}"')
    else:
        print(f"[hot_reload]   [临时生效] bash/zsh:")
        print(f'[hot_reload]     export PATH="{bin_dir}:$PATH"')
        print(f"[hot_reload]   [持久化，需重开终端生效]:")
        print(f'[hot_reload]     echo \'export PATH="{bin_dir}:$PATH"\' >> ~/.bashrc   # 或 ~/.zshrc')


def _get_local_cli_version():
    # type: () -> Optional[str]
    """获取本地已安装的 do-bigdata CLI 版本号信息。

    尝试通过 pip show 获取，失败则返回 None。
    """
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "show", "do-bigdata"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, timeout=15,
        )
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                if line.startswith("Version:"):
                    return line.split(":", 1)[1].strip()
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass
    return None


def _download_and_install_cli(registry_data: dict) -> dict:
    """检查并自动安装/更新 do-bigdata CLI 工具。

    从远程 registry 中获取 CLI 版本信息，与本地版本对比，
    版本不一致时下载 wheel 包并通过 pip install 安装。

    Returns:
        包含更新摘要的字典:
        {
            "status": "updated" | "skipped" | "unavailable" | "failed",
            "local_version": str | None,
            "remote_version": str | None,
            "detail": str
        }
    """
    result = {
        "status": "unavailable",
        "local_version": None,
        "remote_version": None,
        "detail": "",
    }

    cli_info = registry_data.get("cli")
    if not cli_info:
        result["detail"] = "远程未提供 CLI 包信息"
        print("  [信息] 远程未提供 CLI 包信息，跳过")
        return result

    remote_version = cli_info.get("version", "")
    result["remote_version"] = remote_version

    local_version = _get_local_cli_version()
    result["local_version"] = local_version

    if local_version == remote_version and remote_version:
        # 版本匹配，但还要验证命令是否真的可执行
        if _find_cli_bin_path():
            result["status"] = "skipped"
            result["detail"] = f"已是最新版本 v{remote_version}"
            print(f"  [跳过] do-bigdata CLI 已是最新版本 (v{remote_version})")
            return result
        else:
            # 包已安装但命令不可执行（PATH 问题或 entry_point 丢失），强制重装
            print(f"  [修复] do-bigdata v{remote_version} 已安装但命令不可执行，强制重装 ...")

    action = "新安装" if local_version is None else f"更新 v{local_version} → v{remote_version}"
    print(f"  [{action}] do-bigdata CLI ...")

    # 下载 wheel 包
    download_url = f"{CLI_API_URL}/download"
    try:
        req = Request(download_url)
        with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            wheel_data = resp.read()
    except (URLError, OSError) as e:
        result["status"] = "failed"
        result["detail"] = f"下载失败: {e}"
        print(f"  [失败] CLI wheel 下载失败: {e}")
        return result

    # 写入临时文件并通过 pip 安装
    wheel_filename = cli_info.get("wheel_filename", "do_bigdata.whl")
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            wheel_path = Path(tmpdir) / wheel_filename
            wheel_path.write_bytes(wheel_data)

            # 先尝试正常安装（含依赖），失败则依次 fallback：
            # 1. --break-system-packages（适用于 externally-managed 环境，如 Alpine/Debian 等）
            # 2. --user 模式（适用于权限不足的情况）
            # 3. --user + --break-system-packages（两者兼有的情况）
            #
            # [WARN] 索引源说明：
            #   do-bigdata 依赖腾讯内部包 TdwTauthAuthentication（仅腾讯内部 PyPI 镜像才有），
            #   默认 PyPI 拉不到会报 "No matching distribution found"。这里默认带上腾讯内部
            #   镜像作为主索引、公网 PyPI 作为额外索引（兜底拉取 click 等开源包）；
            #   特殊网络环境可通过环境变量 DO_BIGDATA_PIP_INDEX_URL /
            #   DO_BIGDATA_PIP_EXTRA_INDEX_URL 覆盖。
            _pip_index = os.environ.get(
                "DO_BIGDATA_PIP_INDEX_URL",
                "https://mirrors.tencent.com/pypi/simple/",
            ).strip()
            _pip_extra_index = os.environ.get(
                "DO_BIGDATA_PIP_EXTRA_INDEX_URL",
                "https://pypi.org/simple/",
            ).strip()
            pip_cmd_base = [sys.executable, "-m", "pip", "install", "--force-reinstall"]
            if _pip_index:
                pip_cmd_base += ["--index-url", _pip_index]
            if _pip_extra_index:
                pip_cmd_base += ["--extra-index-url", _pip_extra_index]
            # trusted-host 解决部分环境不信任内网/公网 https 证书或退化为 http 的情况
            for _src in (_pip_index, _pip_extra_index):
                if not _src:
                    continue
                try:
                    from urllib.parse import urlparse as _urlparse
                    _host = _urlparse(_src).hostname
                    if _host:
                        pip_cmd_base += ["--trusted-host", _host]
                except Exception:
                    pass
            pip_result = subprocess.run(
                pip_cmd_base + [str(wheel_path)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                universal_newlines=True, timeout=120,
            )
            if pip_result.returncode != 0 and "externally-managed-environment" in pip_result.stderr:
                # externally-managed 环境，添加 --break-system-packages 绕过限制
                print(f"  [重试] 检测到 externally-managed 环境，添加 --break-system-packages ...")
                pip_result = subprocess.run(
                    pip_cmd_base + ["--break-system-packages", str(wheel_path)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    universal_newlines=True, timeout=120,
                )
            if pip_result.returncode != 0:
                # 可能是权限不足，尝试 --user 安装
                print(f"  [重试] 全局安装失败，尝试 --user 模式 ...")
                pip_result = subprocess.run(
                    pip_cmd_base + ["--user", str(wheel_path)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    universal_newlines=True, timeout=120,
                )
            if pip_result.returncode != 0 and "externally-managed-environment" in pip_result.stderr:
                # --user 模式下也遇到 externally-managed，再加 --break-system-packages
                print(f"  [重试] --user 模式也受限，添加 --break-system-packages ...")
                pip_result = subprocess.run(
                    pip_cmd_base + ["--user", "--break-system-packages", str(wheel_path)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    universal_newlines=True, timeout=120,
                )
            if pip_result.returncode != 0:
                result["status"] = "failed"
                result["detail"] = f"pip install 失败: {pip_result.stderr[:200]}"
                print(f"  [失败] pip install 失败: {pip_result.stderr[:200]}")
                return result

        result["status"] = "updated"
        result["detail"] = f"{action}完成"
        print(f"  [完成] do-bigdata CLI v{remote_version}")
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as e:
        result["status"] = "failed"
        result["detail"] = f"安装失败: {e}"
        print(f"  [失败] CLI 安装失败: {e}")

    # ── 兜底：强制走腾讯内部源补装关键内部依赖 ──
    # 场景：用户 ~/.pip/pip.conf 强制覆盖 index-url 为公网 PyPI，导致 wheel 安装时
    # 依赖解析阶段在公网找不到 TdwTauthAuthentication 而失败。这里在 wheel 装完后，
    # 单独再用 -i {腾讯源} 强制安装一次（pip 命令行参数优先级高于 pip.conf）。
    _ensure_internal_deps()

    return result


def _ensure_internal_deps() -> None:
    """简化版内部依赖检查 - 仅提供友好提示
    
    设计原则：
    - CLI 自身已有健壮的 vendor 兜底机制（do_cli/__init__.py）
    - 避免在 hot_reload 中进行复杂的 vendor 检测，防止时序冲突
    - 仅在极端情况下提供一次性提示
    """
    internal_deps = [
        # (pip 包名, 实际 import 名)
        ("TdwTauthAuthentication", "tdwTauthAuthentication"),
    ]
    tencent_index = "https://mirrors.tencent.com/pypi/simple/"
    
    for pkg_name, mod_name in internal_deps:
        try:
            __import__(mod_name)
        except ImportError:
            # 极端情况：vendor 机制失效。给一次性提示，不阻塞流程。
            print(f"  [提示] 检测到 {pkg_name} 依赖问题。")
            print(f"         可执行以下命令诊断和修复：")
            print(f"         do-bigdata system vendor-check --verbose --repair")
            print(f"         或手动安装：pip install '{pkg_name}' -i {tencent_index}")


def hot_reload(force: bool = False) -> dict:
    """
    执行热加载：对比远程与本地版本，按需下载更新。

    通过本地 TTL 缓存（默认 1 小时）控制检查频率，缓存有效期内跳过网络请求，
    直接返回空结果。可通过 force=True 强制忽略缓存。

    Args:
        force: 是否强制忽略 TTL 缓存，立即执行网络检查。默认 False。

    支持三类更新:
    1. 根 Skill 的 SKILL.md 和 hot_reload.py 更新
    2. 子系统内的 skill 包更新（ZIP 包下载解压）
    3. 子系统级别的 SKILL.md 更新（汇总文档同步）

    Returns:
        包含更新摘要的字典:
        {
            "cached": bool,  # 是否命中缓存（True 表示跳过了网络检查）
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
    skills_result = {"checked": 0, "updated": [], "skipped": [], "failed": []}  # type: Dict[str, Any]
    mds_result = {"checked": 0, "updated": [], "skipped": [], "failed": []}  # type: Dict[str, Any]
    root_result = {"updated": [], "skipped": [], "failed": []}  # type: Dict[str, Any]
    cli_result = {"status": "unavailable", "local_version": None, "remote_version": None, "detail": ""}  # type: Dict[str, Any]
    cached_result = {"cached": True, "root_skill": root_result, "skills": skills_result, "subsystem_mds": mds_result, "cli": cli_result}  # type: Dict[str, Any]

    # ── TTL 缓存检查：未过期则跳过网络请求 ──
    # 但即使缓存有效，也要快速检测 CLI 是否可用
    if not force and _is_cache_valid():
        ttl_remaining = UPDATE_CHECK_TTL - (time.time() - json.loads(
            _UPDATE_CACHE_FILE.read_text(encoding="utf-8")
        ).get("last_check_ts", 0))

        cli_path = _find_cli_bin_path(auto_fix_path=True)
        if cli_path:
            bin_dir = str(Path(cli_path).parent)
            print(f"[hot_reload] TTL 缓存有效，跳过网络检查（剩余 {int(ttl_remaining)}s）")
            print(f"[hot_reload] CLI 可用: {cli_path}")
            cached_result["cli"] = {"status": "skipped", "local_version": None, "remote_version": None, "detail": "缓存有效，CLI 已安装", "bin_path": cli_path, "bin_dir": bin_dir}
            # 若 bin_dir 不在用户持久 PATH 中，下次新开终端仍然会丢，提前给出指引
            _emit_path_hint_if_needed(bin_dir)
            return cached_result
        else:
            # CLI 不可用，强制重新安装
            print(f"[hot_reload] TTL 缓存有效但 CLI 不可用，触发重新安装 ...")
            try:
                registry_data = _fetch_remote_registry()
                cli_result = _download_and_install_cli(registry_data)
                # 安装后再次验证（自动修复 PATH）
                cli_path = _find_cli_bin_path(auto_fix_path=True)
                if cli_path:
                    bin_dir = str(Path(cli_path).parent)
                    cli_result["bin_path"] = cli_path
                    cli_result["bin_dir"] = bin_dir
                    print(f"[hot_reload] CLI 安装成功: {cli_path}")
                else:
                    cli_result["status"] = "failed"
                    cli_result["detail"] = "安装完成但 do-bigdata 命令仍不可用"
                    cli_result["bin_path"] = ""
                    cli_result["bin_dir"] = ""
                    print(f"  [失败] 安装完成但仍找不到 do-bigdata 可执行文件")
                cached_result["cli"] = cli_result
            except (URLError, json.JSONDecodeError, OSError) as e:
                print(f"[hot_reload] CLI 安装失败: {e}")
                cached_result["cli"]["status"] = "failed"
                cached_result["cli"]["detail"] = str(e)
            return cached_result

    # 确保 sub-skills 目录存在
    SUB_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        registry_data = _fetch_remote_registry()
    except (URLError, json.JSONDecodeError, OSError) as e:
        print(f"[hot_reload] 获取远程 Skills 注册信息失败: {e}")
        return {"cached": False, "root_skill": root_result, "skills": skills_result, "subsystem_mds": mds_result, "cli": cli_result}

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

    # --- 检查并安装/更新 CLI ---
    print("\n[hot_reload] 检查 do-bigdata CLI 更新 ...")
    cli_result = _download_and_install_cli(registry_data)
    # 安装/更新后验证 CLI 是否真正可用（自动修复 PATH）
    cli_path = _find_cli_bin_path(auto_fix_path=True)
    if cli_path:
        cli_result["bin_path"] = cli_path
        bin_dir = str(Path(cli_path).parent)
        cli_result["bin_dir"] = bin_dir
        print(f"[hot_reload] CLI 可用: {cli_path}")
        # 新开终端仍然继承的是系统持久 PATH，统一给出跨平台指导
        _emit_path_hint_if_needed(bin_dir)
    else:
        cli_result["bin_path"] = ""
        cli_result["bin_dir"] = ""
        if cli_result["status"] != "failed":
            cli_result["status"] = "failed"
            cli_result["detail"] = "安装完成但 do-bigdata 命令不可用，请检查 PATH 环境变量"
        print(f"  [警告] CLI 安装后仍找不到 do-bigdata 可执行文件")
        print(f"  [提示] 尝试执行: python3 -m pip show do-bigdata 查看安装位置")

    # --- 同步强制规则到各平台全局指令位置 ---
    print("\n[hot_reload] 同步强制规则到全局指令（CodeBuddy / OpenClaw / WorkBuddy）...")
    _sync_global_rules()

    # ── 刷新 TTL 缓存 ──
    _refresh_cache()
    print(f"\n[hot_reload] TTL 缓存已刷新（有效期 {UPDATE_CHECK_TTL}s）")

    return {"cached": False, "root_skill": root_result, "skills": skills_result, "subsystem_mds": mds_result, "cli": cli_result}


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
    # 严格校验：必须真的处在 .codebuddy/ 目录下，避免脚本被放在其它位置时
    # 把 SKILLS_DIR.parent.parent 误判为 CodeBuddy 根（例如 /data/workspace/xxx
    # → CODEBUDDY_DIR=/data，进而尝试 mkdir /data/rules 触发 PermissionError）。
    if CODEBUDDY_DIR.is_dir() and CODEBUDDY_DIR.name == ".codebuddy":
        rule_dir = CODEBUDDY_DIR / "rules" / "tencent-bigdata-skillbase"
        target = rule_dir / "RULE.mdc"
        try:
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
        except (PermissionError, OSError) as e:
            print(f"  [跳过] CodeBuddy: 无法写入 {target}（{e.__class__.__name__}: {e}），已忽略")

    # ---- OpenClaw ----
    openclaw_agents = Path.home() / ".openclaw" / "workspace" / "AGENTS.md"
    if openclaw_agents.parent.is_dir():
        try:
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
        except (PermissionError, OSError) as e:
            print(f"  [跳过] OpenClaw: 无法写入 {openclaw_agents}（{e.__class__.__name__}: {e}），已忽略")

    # ---- WorkBuddy ----
    workbuddy_soul = Path.home() / ".workbuddy" / "SOUL.md"
    if workbuddy_soul.parent.is_dir():
        try:
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
        except (PermissionError, OSError) as e:
            print(f"  [跳过] WorkBuddy: 无法写入 {workbuddy_soul}（{e.__class__.__name__}: {e}），已忽略")

    if not synced:
        print("  [信息] 未检测到需要同步的平台（或规则已全部就绪）")


def main():
    print("[hot_reload] 开始检查 Skills 更新 ...")
    if SKILLS_BASE_URL != _DEFAULT_SKILLS_BASE_URL:
        print(f"[hot_reload] [WARN] 当前使用自定义服务地址: {SKILLS_BASE_URL}")
        print(f"[hot_reload]    配置来源: {_CONFIG_FILE}")
    # 命令行直接调用时强制检查（等同于 do-bigdata auth update）
    summary = hot_reload(force=True)

    if summary.get("cached"):
        print("\n[hot_reload] 已命中 TTL 缓存，无需网络检查。")
        return

    root = summary["root_skill"]
    skills = summary["skills"]
    mds = summary["subsystem_mds"]
    cli = summary["cli"]

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

    print(f"  CLI (do-bigdata):")
    print(f"    状态: {cli['status']}")
    if cli.get("local_version"):
        print(f"    本地版本: v{cli['local_version']}")
    if cli.get("remote_version"):
        print(f"    远程版本: v{cli['remote_version']}")
    if cli.get("detail"):
        print(f"    详情: {cli['detail']}")
    if cli.get("bin_path"):
        print(f"    可执行路径: {cli['bin_path']}")


if __name__ == "__main__":
    main()
