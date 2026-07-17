#!/usr/bin/env python3
"""按 rule_key 查 AI-Gallery 作品详情。

GET /api/ai-gallery/dashboards/:rule_key

输出字段严格白名单（其它字段全部丢弃，避免 agent 看到非本 skill 关心的字段）：
    - rule_key
    - name_cn / name_en
    - desc_cn / desc_en
    - tags（保留 id / name_cn / name_en，丢 icon）
    - link
    - is_mine

派生字段（脚本计算，非后端字段；`link` 为空时两者均为 None）：
    - display_url：${DATABRAIN_DISPLAY_HOST}/aigallery/report?path=<encoded link>&name=<encoded name>
                   前端中转页 URL，供 SKILL.md Step 7 直接展示给用户。
                   name 兜底链 name_en || name_cn || rule_key，对齐前端
                   DashboardCard.tsx / CuratorTable.tsx 行为。
                   URL 编码用 `quote(s, safe="!*'()")`，严格对齐 JS
                   `encodeURIComponent`（MDN 规定的"不编码字符集"），让 skill
                   给出的 URL 字面与浏览器地址栏 / 前端 UI 字面一致。
    - legacy_url：${DATABRAIN_DISPLAY_HOST}${link} 旧形态直访 URL，供 Step 8
                  operationLog 双上报（兼容下游历史埋点统计对 `/as/report/` 前缀的识别）。

显式丢弃：visibility / share_users / thumbnail_url / creator* / views / favs /
favorited / link_origin / source / created_at / updated_at / shared_by* / deleted。
特别注意：`share_users` 在 owner 视角下会被后端下发，必须由本脚本过滤掉，
绝不能让 agent 看到。

CLI: --rule-key <key>
"""

from __future__ import annotations

import argparse
import sys
from urllib.parse import quote

from _gallery_client import (
    EXIT_OK,
    EXIT_USAGE,
    GalleryError,
    TIMEOUT_DEFAULT,
    get_display_host,
    handle_gallery_error,
    print_failure,
    print_success,
    request_json,
)

ALLOWED_TAG_FIELDS = ("id", "name_cn", "name_en")

SAFE_URICOMP = "!*'()"


def _filter_tags(tags) -> list[dict]:
    if not isinstance(tags, list):
        return []
    out: list[dict] = []
    for t in tags:
        if not isinstance(t, dict):
            continue
        out.append({k: t.get(k) for k in ALLOWED_TAG_FIELDS})
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch AI-Gallery dashboard detail (whitelist-filtered)."
    )
    parser.add_argument("--rule-key", required=True, help="rule_key, e.g. g-xxxxxxxx")
    args = parser.parse_args()

    rule_key = args.rule_key.strip()
    if not rule_key:
        print_failure(EXIT_USAGE, code=-2, msg="rule-key cannot be empty")
        return EXIT_USAGE

    try:
        data = request_json(
            "GET",
            f"/api/ai-gallery/dashboards/{rule_key}",
            timeout=TIMEOUT_DEFAULT,
        )
    except GalleryError as exc:
        handle_gallery_error(exc)
        return EXIT_USAGE

    if not isinstance(data, dict):
        print_failure(
            EXIT_USAGE,
            code=-1,
            msg=f"unexpected dashboard payload shape: {type(data).__name__}",
        )
        return EXIT_USAGE

    link = data.get("link")
    name_cn = data.get("name_cn")
    name_en = data.get("name_en")

    display_url: str | None = None
    legacy_url: str | None = None
    if isinstance(link, str) and link:
        host = get_display_host().rstrip("/")
        display_name = name_en or name_cn or rule_key
        display_url = (
            f"{host}/aigallery/report"
            f"?path={quote(link, safe=SAFE_URICOMP)}"
            f"&name={quote(str(display_name), safe=SAFE_URICOMP)}"
        )
        legacy_url = f"{host}{link}"

    payload = {
        "rule_key": data.get("rule_key") or rule_key,
        "name_cn": name_cn,
        "name_en": name_en,
        "desc_cn": data.get("desc_cn"),
        "desc_en": data.get("desc_en"),
        "tags": _filter_tags(data.get("tags")),
        "link": link,
        "is_mine": data.get("is_mine"),
        "display_url": display_url,
        "legacy_url": legacy_url,
    }
    print_success(payload)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
