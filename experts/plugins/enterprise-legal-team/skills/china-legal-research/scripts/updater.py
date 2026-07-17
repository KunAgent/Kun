#!/usr/bin/env python3
"""
通用 Skill 自更新模块

从 GitHub monorepo 检测和下载 skill 更新，不依赖 GitHub API。
仅使用公开的 raw.githubusercontent.com（文件下载）和 Atom feed（提交记录）。

使用方式：
  from updater import SkillUpdater
  updater = SkillUpdater(
      skill_root=Path(__file__).resolve().parent.parent,
      repo_raw_base="https://raw.githubusercontent.com/{owner}/{repo}/main/{skill_subdir}",
      commits_feed="https://github.com/{owner}/{repo}/commits/main/{skill_subdir}.atom",
      current_version="1.1.1",
  )
  updater.check_for_update()
"""

import json
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class SkillUpdater:
    """从 GitHub 检测和执行 skill 更新"""

    def __init__(self, skill_root, repo_raw_base, commits_feed, current_version,
                 check_interval_days=7):
        self.skill_root = Path(skill_root)
        self.repo_raw_base = repo_raw_base
        self.commits_feed = commits_feed
        self.current_version = current_version
        self.check_interval_days = check_interval_days

        self.archive_dir = self.skill_root / "archive"
        self.version_check_file = self.archive_dir / "version_check.json"

    @classmethod
    def from_skill_md(cls, skill_root, check_interval_days=7):
        """从 SKILL.md frontmatter 自动构造更新器。

        读取 homepage 和 name，推导 GitHub 更新地址。
        约定：skill 位于 monorepo 的 skills/{name}/ 目录下。
        如需自定义路径，在 frontmatter 中添加 update_path 字段。
        """
        skill_root = Path(skill_root)
        skill_md = skill_root / "SKILL.md"
        if not skill_md.exists():
            raise FileNotFoundError(f"SKILL.md not found in {skill_root}")

        frontmatter = {}
        in_fm = False
        for line in skill_md.read_text("utf-8").splitlines():
            if line.strip() == "---":
                if in_fm:
                    break
                in_fm = True
                continue
            if in_fm and ":" in line:
                key, value = line.split(":", 1)
                frontmatter[key.strip()] = value.strip().strip('"').strip("'")

        homepage = frontmatter.get("homepage", "")
        name = frontmatter.get("name", "")
        version = frontmatter.get("version", "0.0.0")

        # https://github.com/owner/repo → owner/repo
        repo_match = re.match(r'https?://github\.com/([^/]+/[^/]+)', homepage)
        if not repo_match:
            raise ValueError(f"Cannot parse GitHub repo from homepage: {homepage}")
        repo = repo_match.group(1).rstrip("/")

        update_path = frontmatter.get("update_path", f"skills/{name}")
        repo_raw_base = f"https://raw.githubusercontent.com/{repo}/main/{update_path}"
        commits_feed = f"https://github.com/{repo}/commits/main/{update_path}.atom"

        return cls(
            skill_root=skill_root,
            repo_raw_base=repo_raw_base,
            commits_feed=commits_feed,
            current_version=version,
            check_interval_days=check_interval_days,
        )

    # ── 内部方法 ──────────────────────────────────────────

    def _fetch_remote_version(self):
        """从 GitHub 获取远程 SKILL.md 中的版本号"""
        url = f"{self.repo_raw_base}/SKILL.md"
        req = Request(url, headers={"User-Agent": "skill-updater"})
        try:
            with urlopen(req, timeout=10) as resp:
                content = resp.read().decode("utf-8")
        except (HTTPError, URLError, OSError):
            return None, None

        version = None
        in_frontmatter = False
        for line in content.splitlines():
            if line.strip() == "---":
                if in_frontmatter:
                    break
                in_frontmatter = True
                continue
            if in_frontmatter and line.startswith("version:"):
                version = line.split(":", 1)[1].strip().strip('"').strip("'")
                break

        return version, content

    def _fetch_recent_commits(self, per_page=5):
        """通过 Atom feed 获取最近提交记录"""
        req = Request(self.commits_feed, headers={"User-Agent": "skill-updater"})
        try:
            with urlopen(req, timeout=10) as resp:
                content = resp.read().decode("utf-8")
        except (HTTPError, URLError, OSError):
            return []

        ns = {"atom": "http://www.w3.org/2005/Atom"}
        try:
            root = ET.fromstring(content)
            commits = []
            for entry in root.findall("atom:entry", ns)[:per_page]:
                title = entry.find("atom:title", ns).text.strip()
                updated = entry.find("atom:updated", ns).text[:10]
                entry_id = entry.find("atom:id", ns).text
                sha = entry_id.split("/")[-1][:7] if "/" in entry_id else "???"
                commits.append({"sha": sha, "date": updated, "message": title})
            return commits
        except ET.ParseError:
            return []

    @staticmethod
    def _show_recent_commits(commits, limit=5):
        if not commits:
            return
        print("\n最近变更:")
        for c in commits[:limit]:
            print(f"  {c['date']} [{c['sha']}] {c['message']}")

    def _download_file(self, remote_rel_path):
        """从 GitHub 下载单个文件到 skill 目录"""
        local_path = (self.skill_root / remote_rel_path).resolve()
        if not local_path.is_relative_to(self.skill_root.resolve()):
            print(f"  ⚠ 跳过非法路径: {remote_rel_path}", file=sys.stderr)
            return False
        url = f"{self.repo_raw_base}/{remote_rel_path}"
        req = Request(url, headers={"User-Agent": "skill-updater"})
        try:
            with urlopen(req, timeout=30) as resp:
                content = resp.read()
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(content)
            return True
        except (HTTPError, URLError, OSError):
            return False

    def _should_auto_check(self):
        if not self.version_check_file.exists():
            return True
        try:
            data = json.loads(self.version_check_file.read_text("utf-8"))
            last = datetime.fromisoformat(data["last_check"])
            return (datetime.now() - last).days >= self.check_interval_days
        except (json.JSONDecodeError, KeyError, ValueError, OSError):
            return True

    def _mark_checked(self, remote_version=None, status="checked"):
        self.archive_dir.mkdir(exist_ok=True)
        now = datetime.now()
        next_check = now + timedelta(days=self.check_interval_days)
        data = {
            "last_check": now.isoformat(timespec="seconds"),
            "next_check": next_check.strftime("%Y-%m-%d"),
            "local_version": self.current_version,
            "remote_version": remote_version,
            "status": status,
        }
        self.version_check_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), "utf-8"
        )

    @staticmethod
    def _parse_version(version_str):
        return tuple(int(x) for x in version_str.split("."))

    def _read_local_version(self):
        """从 SKILL.md 重新读取本地版本号"""
        skill_md = self.skill_root / "SKILL.md"
        if not skill_md.exists():
            return self.current_version
        in_fm = False
        for line in skill_md.read_text("utf-8").splitlines():
            if line.strip() == "---":
                if in_fm:
                    break
                in_fm = True
                continue
            if in_fm and line.startswith("version:"):
                return line.split(":", 1)[1].strip().strip('"').strip("'")
        return self.current_version

    # ── 公开方法 ──────────────────────────────────────────

    def _fetch_changelog_diff(self):
        """读取远程 CHANGELOG.md 中本地版本号之后的所有版本变更"""
        url = f"{self.repo_raw_base}/CHANGELOG.md"
        req = Request(url, headers={"User-Agent": "skill-updater"})
        try:
            with urlopen(req, timeout=10) as resp:
                changelog = resp.read().decode("utf-8")
        except (HTTPError, URLError, OSError):
            return None

        # 提取本地版本号之后的所有版本段落
        lines = []
        capture = False
        for line in changelog.splitlines():
            if line.startswith("## ["):
                ver = line.split("]")[0].replace("## [", "").strip()
                try:
                    if self._parse_version(ver) <= self._parse_version(self.current_version):
                        break  # 到达本地版本，停止
                    capture = True
                except ValueError:
                    pass
            if capture:
                lines.append(line)

        return "\n".join(lines) if lines else None

    def check_for_update(self, force=False):
        """自动版本检测（超过间隔才触发），有新版本时打印提示"""
        if not force and not self._should_auto_check():
            return

        remote_version, _ = self._fetch_remote_version()

        if remote_version is None:
            self._mark_checked(status="network_error")
            return

        if self._parse_version(remote_version) <= self._parse_version(self.current_version):
            self._mark_checked(remote_version, "up_to_date")
            return

        self._mark_checked(remote_version, "update_available")
        print(f"🔄 有新版本: {self.current_version} → {remote_version}")
        print(f"   更新命令: python3 scripts/yd_search.py do-update")

        self._show_recent_commits(self._fetch_recent_commits())

        # 显示 CHANGELOG 中本地版本之后的变更
        diff = self._fetch_changelog_diff()
        if diff:
            print(f"\n{'─' * 50}")
            print(diff)
            print(f"{'─' * 50}")
        print()

    def cmd_check_update(self):
        """手动检查版本更新（交互式，用于 check-update 子命令）"""
        print(f"当前版本: {self.current_version}")

        if self.version_check_file.exists():
            try:
                data = json.loads(self.version_check_file.read_text("utf-8"))
                print(f"上次检测: {data.get('last_check', '未知')}")
                print(f"下次自动检测: {data.get('next_check', '未知')}")
                if data.get("remote_version"):
                    print(f"远程版本: {data['remote_version']} ({data.get('status', '')})")
            except (json.JSONDecodeError, OSError):
                pass
        else:
            print("尚未进行过版本检测")

        print(f"\n检查远程: {self.repo_raw_base}/SKILL.md ...")
        remote_version, _ = self._fetch_remote_version()

        if remote_version is None:
            self._mark_checked(status="network_error")
            print("无法连接远程仓库，请检查网络。")
            return False

        is_newer = self._parse_version(remote_version) > self._parse_version(self.current_version)
        self._mark_checked(remote_version, "update_available" if is_newer else "up_to_date")

        if is_newer:
            print(f"有新版本可用: {self.current_version} → {remote_version}")
            print(f"更新命令: python3 scripts/yd_search.py do-update")
        else:
            print(f"已是最新版本 ({self.current_version})。")

        self._show_recent_commits(self._fetch_recent_commits())
        return True

    def cmd_do_update(self):
        """执行更新：从远程下载 MANIFEST.json 中的文件（仅覆盖 skill 目录，不碰 .env 和 archive）"""
        print(f"正在更新 ...")
        print(f"本地路径: {self.skill_root}")
        print(f"远程源:   {self.repo_raw_base}\n")

        manifest_url = f"{self.repo_raw_base}/scripts/MANIFEST.json"
        req = Request(manifest_url, headers={"User-Agent": "skill-updater"})
        try:
            with urlopen(req, timeout=10) as resp:
                manifest = json.loads(resp.read().decode("utf-8"))
            all_files = manifest.get("files", [])
        except (HTTPError, URLError, OSError, json.JSONDecodeError):
            print("  ⚠ 无法获取远程文件清单，仅更新核心文件")
            all_files = ["SKILL.md", "CHANGELOG.md", "scripts/yd_search.py"]

        updated = 0
        failed = 0

        for remote_path in all_files:
            if self._download_file(remote_path):
                print(f"  ✓ {remote_path}")
                updated += 1
            else:
                print(f"  ✗ {remote_path}")
                failed += 1

        new_version = self._read_local_version()
        self._mark_checked(new_version, "updated")
        print(f"\n更新完成: {updated} 个文件已更新, {failed} 个失败")
        print(f"版本: {self.current_version} → {new_version}")
        print("注: .env 文件和归档数据不会被修改。")
