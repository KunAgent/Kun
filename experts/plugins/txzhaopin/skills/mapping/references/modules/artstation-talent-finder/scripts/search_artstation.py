#!/usr/bin/env python3
"""
ArtStation Talent Finder - 搜索 ArtStation 上的艺术家/设计师
通过 Playwright 驱动真实浏览器访问 ArtStation，彻底绕过 Cloudflare 保护。
生成人选名单（Excel / Markdown）。

用法:
    python search_artstation.py --query "concept art" --max 20 --output results.xlsx
    python search_artstation.py --query "3D character" --skills "Unreal Engine,ZBrush" --max 30 --format md
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import zipfile
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape as xml_escape

# 检查 Playwright 是否可用
_HAS_PLAYWRIGHT = False
try:
    from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page
    _HAS_PLAYWRIGHT = True
except ImportError:
    pass

# 不依赖 Playwright 的轻量 fallback
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
import gzip


# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────
SEARCH_USERS_URL = "https://www.artstation.com/api/v2/search/users.json"
SEARCH_PROJECTS_URL = "https://www.artstation.com/api/v2/search/projects.json"
USER_PROFILE_URL = "https://www.artstation.com/users/{username}.json"
ARTSTATION_PROFILE = "https://www.artstation.com/{username}"
PER_PAGE = 50


# ─────────────────────────────────────────────
# Playwright-based Browser Session（主力方案）
# ─────────────────────────────────────────────
class PlaywrightSession:
    """
    使用 Playwright 驱动真实 Chromium 浏览器。
    Cloudflare 无法区分这是脚本还是真人。
    """

    def __init__(self):
        self._pw = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None

    def start(self) -> None:
        print("  🌐 启动浏览器 (Chromium headless)...")
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ]
        )
        self._context = self._browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            locale="en-US",
        )
        self._page = self._context.new_page()

        # 先访问主页，让 Cloudflare 完成验证
        print("  🍪 访问 ArtStation 主页获取 Cloudflare 通行证...")
        try:
            self._page.goto("https://www.artstation.com/", wait_until="domcontentloaded", timeout=30000)
            # 等一下 Cloudflare challenge（如果有的话）
            time.sleep(2)
            print("  ✅ 浏览器会话就绪")
        except Exception as e:
            print(f"  ⚠️  主页加载异常: {e}，继续尝试...")

    def request_json(self, url: str, max_retries: int = 3) -> dict | None:
        """通过浏览器上下文发送 API 请求，自动携带 cookies。"""
        if not self._page:
            self.start()

        for attempt in range(1, max_retries + 1):
            try:
                # 使用 page.evaluate 在浏览器环境中 fetch，完全模拟浏览器行为
                result = self._page.evaluate("""
                    async (url) => {
                        try {
                            const resp = await fetch(url, {
                                headers: {
                                    'Accept': 'application/json, text/plain, */*',
                                },
                                credentials: 'include',
                            });
                            if (!resp.ok) {
                                return { error: resp.status, statusText: resp.statusText };
                            }
                            const data = await resp.json();
                            return { data: data };
                        } catch (e) {
                            return { error: -1, message: e.message };
                        }
                    }
                """, url)

                if "data" in result:
                    return result["data"]

                error_code = result.get("error", -1)
                if error_code == 429:
                    wait = (2 ** attempt) + random.uniform(0, 1)
                    print(f"  ⏳ 频率限制 (429)，等待 {wait:.1f}s ({attempt}/{max_retries})...")
                    time.sleep(wait)
                    continue
                elif error_code == 403:
                    if attempt < max_retries:
                        wait = (2 ** attempt) + random.uniform(0.5, 2)
                        print(f"  ⚠️  403，重新加载页面重试 ({attempt}/{max_retries})...")
                        self._page.goto("https://www.artstation.com/", wait_until="domcontentloaded", timeout=20000)
                        time.sleep(wait)
                        continue
                    return None
                else:
                    if attempt < max_retries:
                        time.sleep(1)
                        continue
                    print(f"  ❌ 请求失败: {result}")
                    return None
            except Exception as e:
                if attempt < max_retries:
                    time.sleep(1)
                    continue
                print(f"  ❌ 异常: {e}")
                return None
        return None

    def close(self) -> None:
        try:
            if self._browser:
                self._browser.close()
            if self._pw:
                self._pw.stop()
        except:
            pass


# ─────────────────────────────────────────────
# urllib fallback session（无 Playwright 时使用）
# ─────────────────────────────────────────────
class UrllibSession:
    """轻量 fallback，不需要 Playwright。"""

    USER_AGENTS = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ]

    def __init__(self):
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar)
        )
        self.ua = random.choice(self.USER_AGENTS)

    def start(self) -> None:
        print("  🌐 使用 urllib（无 Playwright fallback）...")
        try:
            headers = {
                "User-Agent": self.ua,
                "Accept": "text/html,application/xhtml+xml",
            }
            req = urllib.request.Request("https://www.artstation.com/", headers=headers)
            self.opener.open(req, timeout=15).read()
        except:
            pass

    def request_json(self, url: str, max_retries: int = 3) -> dict | None:
        for attempt in range(1, max_retries + 1):
            try:
                headers = {
                    "User-Agent": self.ua,
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Referer": "https://www.artstation.com/",
                    "Origin": "https://www.artstation.com",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "same-origin",
                }
                req = urllib.request.Request(url, headers=headers)
                resp = self.opener.open(req, timeout=15)
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw)
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    time.sleep(2 ** attempt)
                    continue
                elif exc.code == 403:
                    if attempt < max_retries:
                        self.ua = random.choice(self.USER_AGENTS)
                        time.sleep(2 ** attempt)
                        continue
                    return None
                return None
            except:
                if attempt < max_retries:
                    time.sleep(1)
                    continue
                return None
        return None

    def close(self) -> None:
        pass


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
def extract_email_from_text(text: str) -> str:
    if not text:
        return ""
    match = re.search(r'[\w.+-]+@[\w-]+\.[\w.-]+', text)
    if not match:
        return ""
    email = match.group(0)
    # 过滤掉 ArtStation 脱敏邮箱（未登录时返回 ***@email.com）
    if re.match(r'^\*+@', email) or email.endswith('@email.com'):
        return ""
    return email


def _parse_user_from_search(user: dict) -> dict[str, Any]:
    username = user.get("username", user.get("subdomain", ""))
    full_name = user.get("full_name", user.get("name", username))
    headline = user.get("headline", "")
    city = user.get("city", "")
    user_country = user.get("country", "")
    location = f"{city}, {user_country}".strip(", ")
    followers = user.get("followers_count", 0)
    skills_list = user.get("skills", [])
    if isinstance(skills_list, list) and skills_list and isinstance(skills_list[0], dict):
        skills_list = [s.get("name", str(s)) for s in skills_list]

    return {
        "name": full_name,
        "username": username,
        "url": ARTSTATION_PROFILE.format(username=username),
        "headline": headline,
        "location": location,
        "followers_count": followers,
        "skills": skills_list,
        "email": "",
        "avatar_url": user.get("medium_avatar_url", user.get("avatar_url", "")),
    }


def _matches_filters(user_data: dict, country: str, skill_filter: str) -> bool:
    if country and country.lower() not in (user_data.get("location", "") or "").lower():
        return False
    if skill_filter:
        required = {s.strip().lower() for s in skill_filter.split(",")}
        user_skills_lower = {s.lower() for s in user_data.get("skills", [])}
        if not required & user_skills_lower:
            return False
    return True


# ─────────────────────────────────────────────
# Core: 搜索用户
# ─────────────────────────────────────────────
def search_users(session, query: str, max_results: int = 20,
                 country: str = "", skill_filter: str = "") -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    page = 1

    print(f"\n🔍 搜索 ArtStation 用户: \"{query}\"")
    if country:
        print(f"   国家筛选: {country}")
    if skill_filter:
        print(f"   技能筛选: {skill_filter}")
    print(f"   最大结果数: {max_results}\n")

    # 先尝试用户搜索 API
    while len(results) < max_results:
        params = urllib.parse.urlencode({
            "query": query,
            "page": page,
            "per_page": min(PER_PAGE, max_results - len(results)),
        })
        url = f"{SEARCH_USERS_URL}?{params}"
        data = session.request_json(url)

        if data is None:
            if page == 1:
                print("  ⚠️  用户搜索 API 受限，切换到作品搜索...")
                return _fallback_project_search(session, query, max_results, country, skill_filter)
            break

        users_data = data.get("data", data.get("users", []))
        if not users_data:
            if isinstance(data, list):
                users_data = data
            else:
                users_data = data.get("results", [])
        if not users_data:
            break

        for user in users_data:
            if len(results) >= max_results:
                break
            parsed = _parse_user_from_search(user)
            if _matches_filters(parsed, country, skill_filter):
                results.append(parsed)

        page += 1
        time.sleep(random.uniform(0.5, 1.5))
        if len(users_data) < PER_PAGE:
            break

    if results:
        print(f"  ✅ 搜索完成，找到 {len(results)} 位艺术家\n")
    return results


def _fallback_project_search(session, query: str, max_results: int,
                             country: str, skill_filter: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    seen_usernames: set[str] = set()
    page = 1

    print("  📡 使用作品搜索来发现艺术家...")

    while len(results) < max_results and page <= 15:
        params = urllib.parse.urlencode({
            "query": query,
            "page": page,
            "per_page": PER_PAGE,
        })
        url = f"{SEARCH_PROJECTS_URL}?{params}"
        data = session.request_json(url)

        if data is None:
            break

        projects = data.get("data", data.get("projects", []))
        if isinstance(data, list):
            projects = data
        if not projects:
            break

        for proj in projects:
            if len(results) >= max_results:
                break
            user_info = proj.get("user", {})
            if not user_info:
                continue
            username = user_info.get("username", user_info.get("subdomain", ""))
            if not username or username in seen_usernames:
                continue
            seen_usernames.add(username)
            parsed = _parse_user_from_search(user_info)
            if _matches_filters(parsed, country, ""):
                results.append(parsed)

        page += 1
        time.sleep(random.uniform(0.5, 1.5))

    print(f"  ✅ 作品搜索完成，找到 {len(results)} 位艺术家\n")
    return results


# ─────────────────────────────────────────────
# Enrich: 获取用户详情
# ─────────────────────────────────────────────
def enrich_user_profiles(session, users: list[dict],
                         fetch_details: bool = True) -> list[dict]:
    if not fetch_details:
        return users

    print("📋 获取用户详细信息...\n")
    consecutive_failures = 0
    max_consecutive_failures = 5
    success_count = 0
    fail_count = 0

    for i, user in enumerate(users, 1):
        if consecutive_failures >= max_consecutive_failures:
            remaining = len(users) - i + 1
            print(f"\n  ⚠️  连续 {max_consecutive_failures} 次失败，跳过剩余 {remaining} 人。")
            print(f"      已成功获取 {success_count} 人的详细信息。")
            break

        username = user.get("username", "")
        print(f"  [{i}/{len(users)}] {user['name']} (@{username}) ...", end=" ", flush=True)

        profile_url = USER_PROFILE_URL.format(username=username)
        profile = session.request_json(profile_url)

        if profile:
            consecutive_failures = 0
            success_count += 1

            if not user.get("headline"):
                user["headline"] = profile.get("headline", "")

            # 技能
            skills_raw = profile.get("skills", [])
            if isinstance(skills_raw, list):
                if skills_raw and isinstance(skills_raw[0], dict):
                    user["skills"] = [s.get("name", "") for s in skills_raw]
                elif skills_raw:
                    user["skills"] = list(skills_raw)

            # 软件工具 — 合并到技能中
            software_raw = profile.get("software", [])
            if isinstance(software_raw, list) and software_raw:
                existing = set(s.lower() for s in user.get("skills", []))
                for sw in software_raw:
                    name = sw.get("name", sw) if isinstance(sw, dict) else str(sw)
                    if name and name.lower() not in existing:
                        user.setdefault("skills", []).append(name)
                        existing.add(name.lower())

            # 邮箱 — 从多个字段中提取
            email = ""

            # 1) 优先从 social_profiles 中取 public_email 类型
            for sp in profile.get("social_profiles", []):
                if sp.get("social_network") == "public_email":
                    found = extract_email_from_text(sp.get("url", ""))
                    if found:
                        email = found
                    break

            # 2) 其他社交链接中找邮箱
            if not email:
                for sp in profile.get("social_profiles", []):
                    if sp.get("social_network") == "public_email":
                        continue
                    found = extract_email_from_text(sp.get("url", ""))
                    if found:
                        email = found
                        break

            # 3) 从简介、headline 中用正则提取
            if not email:
                bio = profile.get("about", "") or ""
                headline_text = profile.get("headline", "") or ""
                # 也检查 portfolio summary
                portfolio_summary = ""
                portfolio = profile.get("portfolio")
                if isinstance(portfolio, dict):
                    portfolio_summary = portfolio.get("summary", "") or ""
                email = (extract_email_from_text(bio)
                         or extract_email_from_text(headline_text)
                         or extract_email_from_text(portfolio_summary))

            user["email"] = email

            # 标记是否有公开邮箱（未登录看不到真实值）
            has_public_email = profile.get("has_public_email", False)
            user["has_public_email"] = has_public_email
            if has_public_email and not email:
                user["email"] = "📧 有公开邮箱(子域名可抓取)"

            # 位置
            city = profile.get("city", "")
            pcountry = profile.get("country", "")
            if city or pcountry:
                user["location"] = f"{city}, {pcountry}".strip(", ")

            user["followers_count"] = profile.get("followers_count", user.get("followers_count", 0))

            print("✅")
            time.sleep(random.uniform(0.3, 1.0))
        else:
            consecutive_failures += 1
            fail_count += 1
            print("⏭️  跳过")
            time.sleep(random.uniform(1.0, 2.0))

    print(f"\n  📊 详情获取: {success_count} 成功 / {fail_count} 失败 / {len(users)} 总计")
    return users


# ─────────────────────────────────────────────
# Subdomain Email Extraction (关键功能!)
# ─────────────────────────────────────────────
def enrich_emails_via_subdomain(users: list) -> list:
    """
    通过 {username}.artstation.com 子域名页面抓取真实邮箱。

    关键发现：ArtStation 主域名的 API 对未登录用户返回脱敏邮箱
    (`***********@email.com`)，但老版本的子域名个人主页
    (https://{username}.artstation.com/) 会把真实邮箱以明文渲染到 HTML 中，
    无需登录即可抓取。

    需要 Playwright（Cloudflare 反爬）。
    """
    if not _HAS_PLAYWRIGHT:
        print("\n⚠️  子域名邮箱提取需要 Playwright，跳过。")
        return users

    # 筛选需要抓取的用户：标记有公开邮箱 但 email 为空或脱敏
    targets = []
    for u in users:
        em = u.get("email", "") or ""
        has = u.get("has_public_email", False)
        if has and (not em or "有公开邮箱" in em or "@email.com" in em):
            targets.append(u)

    if not targets:
        return users

    print(f"\n🔍 通过子域名提取真实邮箱 ({len(targets)} 位候选人)...")

    BAD_TOKENS = [
        'artstation', 'sentry', 'cloudflare', 'email.com', 'support', 'privacy',
        'example', 'flags', 'globe', 'webp', 'svg', 'ttf', 'woff', 'png', 'jpg',
        'css', 'js.', '2x.',
    ]

    def _is_real_email(e: str) -> bool:
        el = e.lower()
        for b in BAD_TOKENS:
            if b in el:
                return False
        return 5 < len(e) < 60

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        )
        ctx = browser.new_context(
            viewport={'width': 1440, 'height': 900},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                       'AppleWebKit/537.36 (KHTML, like Gecko) '
                       'Chrome/131.0.0.0 Safari/537.36',
            locale='en-US',
        )
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
        page = ctx.new_page()

        # 预热：首次访问一定会被 Cloudflare 拦截，等其通过后后续会成功
        # 关键：先访问主站获得 Cloudflare cookies，再访问子域名会立即通过
        # （直接访问子域名会被 Cloudflare 拦截很久）
        try:
            page.goto('https://www.artstation.com/', timeout=60000)
            for _ in range(15):
                time.sleep(2)
                t = page.title()
                if t and 'moment' not in t.lower() and 'just' not in t.lower():
                    break
            print(f"  🔥 主站预热完成: {page.title()}")
        except Exception:
            pass

        found = 0
        consecutive_fails = 0
        for i, user in enumerate(targets, 1):
            un = user.get("username", "")
            if not un:
                continue

            real_emails = []
            for attempt in range(2):
                try:
                    page.goto(f'https://{un}.artstation.com/', timeout=25000)
                    # 等待 Cloudflare 通过
                    for _ in range(10):
                        time.sleep(1.2)
                        t = page.title()
                        if t and 'moment' not in t.lower() and 'just' not in t.lower():
                            break
                    t = page.title() or ""
                    if not t or 'moment' in t.lower() or 'just' in t.lower():
                        if attempt == 0:
                            time.sleep(2)
                            continue
                        break
                    # 提取邮箱
                    html = page.content()
                    text = page.evaluate("() => document.body.innerText")
                    emails = re.findall(r'[\w.+-]+@[\w-]+\.[\w.-]+', text + ' ' + html)
                    real_emails = list(set(e for e in emails if _is_real_email(e)))
                    break
                except Exception:
                    if attempt == 0:
                        time.sleep(2)
                        continue

            if real_emails:
                user["email"] = ' / '.join(real_emails)
                user["email_source"] = "subdomain"
                found += 1
                consecutive_fails = 0
                print(f"  [{i}/{len(targets)}] ✉️  {user.get('name', un)} → {user['email']}")
            else:
                consecutive_fails += 1
                print(f"  [{i}/{len(targets)}]    {user.get('name', un)} → 未抓取到")
                if consecutive_fails >= 8:
                    print(f"\n  ⚠️  连续 {consecutive_fails} 次失败，停止")
                    break

            time.sleep(random.uniform(0.3, 0.8))

        try:
            browser.close()
        except Exception:
            pass

    print(f"\n  📊 子域名邮箱: {found}/{len(targets)} 成功 ({found * 100 // max(len(targets), 1)}%)")
    return users


# ─────────────────────────────────────────────
# Output: Excel
# ─────────────────────────────────────────────
def save_xlsx(users: list[dict], filepath: str) -> str:
    filepath = os.path.abspath(filepath)
    columns = [
        ("name", "姓名"),
        ("username", "用户名"),
        ("url", "ArtStation 链接"),
        ("email", "邮箱"),
        ("headline", "简介/头衔"),
        ("skills", "技能"),
        ("location", "地区"),
        ("followers_count", "粉丝数"),
    ]

    def _col_letter(idx: int) -> str:
        result = ""
        while True:
            result = chr(idx % 26 + ord('A')) + result
            idx = idx // 26 - 1
            if idx < 0:
                break
        return result

    def _cell_value(user: dict, key: str) -> str:
        val = user.get(key, "")
        if key == "skills" and isinstance(val, list):
            val = ", ".join(val)
        if val is None:
            val = ""
        return str(val)

    shared_strings: list[str] = []
    ss_index: dict[str, int] = {}

    def _get_ss_idx(text: str) -> int:
        if text not in ss_index:
            ss_index[text] = len(shared_strings)
            shared_strings.append(text)
        return ss_index[text]

    for _, header in columns:
        _get_ss_idx(header)
    for u in users:
        for key, _ in columns:
            _get_ss_idx(_cell_value(u, key))

    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>'''

    rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''

    workbook_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''

    workbook_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="ArtStation人才" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>'''

    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4472C4"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>'''

    ss_parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">',
    ]
    for s in shared_strings:
        ss_parts.append(f"  <si><t>{xml_escape(s)}</t></si>")
    ss_parts.append("</sst>")
    shared_strings_xml = "\n".join(ss_parts)

    num_cols = len(columns)
    last_col = _col_letter(num_cols - 1)
    last_row = len(users) + 1

    sheet_lines = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        f'  <dimension ref="A1:{last_col}{last_row}"/>',
        '  <cols>',
    ]
    col_widths = [18, 16, 36, 28, 40, 36, 20, 12]
    for ci, w in enumerate(col_widths):
        c1 = ci + 1
        sheet_lines.append(f'    <col min="{c1}" max="{c1}" width="{w}" customWidth="1"/>')
    sheet_lines.append('  </cols>')
    sheet_lines.append('  <sheetData>')

    sheet_lines.append('    <row r="1">')
    for ci, (_, header) in enumerate(columns):
        col = _col_letter(ci)
        idx = _get_ss_idx(header)
        sheet_lines.append(f'      <c r="{col}1" t="s" s="1"><v>{idx}</v></c>')
    sheet_lines.append('    </row>')

    for ri, u in enumerate(users, 2):
        sheet_lines.append(f'    <row r="{ri}">')
        for ci, (key, _) in enumerate(columns):
            col = _col_letter(ci)
            if key == "followers_count":
                num_val = u.get("followers_count", 0)
                sheet_lines.append(f'      <c r="{col}{ri}"><v>{num_val}</v></c>')
            else:
                val = _cell_value(u, key)
                idx = _get_ss_idx(val)
                sheet_lines.append(f'      <c r="{col}{ri}" t="s"><v>{idx}</v></c>')
        sheet_lines.append('    </row>')

    sheet_lines.append('  </sheetData>')
    sheet_lines.append(f'  <autoFilter ref="A1:{last_col}{last_row}"/>')
    sheet_lines.append('</worksheet>')
    sheet_xml = "\n".join(sheet_lines)

    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/styles.xml", styles_xml)
        zf.writestr("xl/sharedStrings.xml", shared_strings_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)

    with open(filepath, "wb") as f:
        f.write(buf.getvalue())

    print(f"📊 Excel 已保存: {filepath}")
    return filepath


# ─────────────────────────────────────────────
# Output: Markdown
# ─────────────────────────────────────────────
def save_markdown(users: list[dict], filepath: str) -> str:
    filepath = os.path.abspath(filepath)
    lines = [
        "# ArtStation 人才搜索结果\n",
        f"> 共找到 **{len(users)}** 位候选人\n",
        "| # | 姓名 | 链接 | 邮箱 | 简介 | 技能 | 地区 | 粉丝数 |",
        "|---|------|------|------|------|------|------|--------|",
    ]
    for i, u in enumerate(users, 1):
        skills_str = ", ".join(u.get("skills", [])[:5])
        if len(u.get("skills", [])) > 5:
            skills_str += "..."
        email = u.get("email", "") or "-"
        headline = (u.get("headline", "") or "-").replace("|", "/")
        name = u.get("name", u.get("username", ""))
        url = u.get("url", "")
        location = u.get("location", "") or "-"
        followers = u.get("followers_count", 0)
        lines.append(
            f"| {i} | {name} | [ArtStation]({url}) | {email} | {headline} | {skills_str} | {location} | {followers} |"
        )
    lines.append(f"\n---\n*Generated by ArtStation Talent Finder*\n")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"📄 Markdown 已保存: {filepath}")
    return filepath


def print_summary(users: list[dict]) -> None:
    print("\n" + "=" * 70)
    print("  ArtStation 人才搜索结果摘要")
    print("=" * 70)
    for i, u in enumerate(users, 1):
        print(f"\n  {i}. {u.get('name', '')} (@{u.get('username', '')})")
        print(f"     🔗 {u.get('url', '')}")
        if u.get("email"):
            print(f"     📧 {u['email']}")
        if u.get("headline"):
            print(f"     📝 {u['headline']}")
        if u.get("skills"):
            print(f"     🎨 {', '.join(u['skills'][:8])}")
        if u.get("location"):
            print(f"     📍 {u['location']}")
        print(f"     👥 {u.get('followers_count', 0)} followers")
    print("\n" + "=" * 70)


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="ArtStation Talent Finder - 搜索 ArtStation 上的艺术家/设计师"
    )
    parser.add_argument("--query", "-q", required=True, help="搜索关键词")
    parser.add_argument("--max", "-m", type=int, default=20, help="最大结果数 (默认: 20)")
    parser.add_argument("--country", "-c", default="", help="国家/地区过滤")
    parser.add_argument("--skills", "-s", default="", help="技能过滤（逗号分隔）")
    parser.add_argument("--output", "-o", default="artstation_results", help="输出路径（不含扩展名）")
    parser.add_argument("--format", "-f", choices=["xlsx", "md", "both"], default="both", help="输出格式")
    parser.add_argument("--no-details", action="store_true", help="跳过获取详细信息")
    parser.add_argument("--no-email-extract", action="store_true",
                        help="跳过通过子域名提取真实邮箱（默认会自动提取）")
    parser.add_argument("--no-browser", action="store_true", help="强制不使用 Playwright（使用 urllib fallback）")

    args = parser.parse_args()

    # 选择 Session 类型
    use_playwright = _HAS_PLAYWRIGHT and not args.no_browser
    if use_playwright:
        print("🚀 使用 Playwright 浏览器模式（可绕过 Cloudflare）")
        session = PlaywrightSession()
    else:
        if not _HAS_PLAYWRIGHT:
            print("⚠️  Playwright 未安装，使用 urllib 模式（详情获取可能受 Cloudflare 限制）")
            print("   安装: pip install playwright && playwright install chromium")
        else:
            print("📡 使用 urllib 模式（--no-browser 选项）")
        session = UrllibSession()

    session.start()

    try:
        # 搜索
        users = search_users(
            session=session,
            query=args.query,
            max_results=args.max,
            country=args.country,
            skill_filter=args.skills,
        )

        if not users:
            print("\n❌ 未找到任何结果，请尝试不同的关键词。")
            sys.exit(1)

        # 获取详细信息
        users = enrich_user_profiles(session, users, fetch_details=not args.no_details)

        # 通过子域名页面提取真实邮箱（关键步骤：绕过 ArtStation API 脱敏）
        if not args.no_details and not args.no_email_extract:
            users = enrich_emails_via_subdomain(users)

        # 输出
        print_summary(users)

        output_base = args.output
        if output_base.endswith(('.xlsx', '.md')):
            output_base = os.path.splitext(output_base)[0]

        generated_files = []
        if args.format in ("xlsx", "both"):
            f = save_xlsx(users, f"{output_base}.xlsx")
            generated_files.append(f)
        if args.format in ("md", "both"):
            f = save_markdown(users, f"{output_base}.md")
            generated_files.append(f)

        print(f"\n🎉 完成！共找到 {len(users)} 位候选人。")
        for gf in generated_files:
            print(f"   📁 {gf}")

        return users
    finally:
        session.close()


if __name__ == "__main__":
    main()
