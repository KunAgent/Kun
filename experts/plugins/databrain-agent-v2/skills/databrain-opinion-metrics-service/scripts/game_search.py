#!/usr/bin/env python3
"""
Resolve game/company name(s) → DataBrain IDs via ChatBI search API.

本 skill 为「舆情指标」服务。上游 react_agent_service 的 system prompt 只提供
游戏名 + 平台类型，**不直接注入 BigQuery 用的游戏 ID**。所以 SQL 之前必须先用
本脚本把名字解析成 ID，再去填入查询的 WHERE 子句。

返回的 ID 字段含义（**同一游戏在不同表里物理列名不同！**）：
    mobile_id   = unified_id  (前缀 u)  → 手游店 store_score_app_store_*/google_play_* 用 unified_id 列；舆情主表用 unified_edition_id 列
    pc_id       = edition_id  (前缀 e)  → PC 商店 store_score_steam_* 等用 edition_id 列；舆情主表用 unified_edition_id 列
    console_id  = edition_id  (前缀 e)  → Console 商店 store_score_playstation/xbox 用 edition_id 列
    combine_id  = combined_id (前缀 c)  → 跨端聚合（本舆情 skill 一般不直接用，保留以便跨 skill 调用）
    entity_id   = UUID                  → 公司/开发商/发行商详情页
    game_id     = mobile_id 或 pc_id    → 顶层兼容字段，等价于「该游戏的 unified_edition_id」（前缀 u 或 e）

各表过滤键速查见 references/auxiliary/id_mapping.md。

环境变量：
    DATABRAIN_TOKEN  - 认证 token（不含 Bearer 前缀）；服务端注入（required）
    DATABRAIN_HOST   - 单一 API host（默认 https://databrain.intlgame.com）

Usage:
    # 游戏（不指定类型 → 4 层字符串 fallback：原样 → lowercase → 首词 → auto by entity_type）
    python game_search.py "Genshin Impact"
    python game_search.py "Wuthering Waves" --type mobile
    python game_search.py "Counter-Strike 2" --type pc --top 3

    # 公司 / 开发商 / 发行商
    python game_search.py "SYBO" --type company
    python game_search.py "miHoYo" --type company

    # batch 多 keyword 一次解析
    python game_search.py "Genshin Impact" "Honkai: Star Rail"

    # 输出纯 JSON（供 agent 解析）
    OUTPUT_JSON=1 python game_search.py "Dune: Awakening"

向后兼容：
    - 旧 CLI 参数 --top / --entity-type / --systems 仍可用
    - `from game_search import search_games` 别名保留
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover - 运行时兜底
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _utils import get_host, require_token, check_http_auth

DEFAULT_HOST = get_host()
SEARCH_PATH = "/api/v1/intelligence_pc/chatbi/search"

# 不指定 entity_type 时自动回退顺序（优先 mobile，舆情场景手游/PC 兼有，最后试 company）
AUTO_FALLBACK_TYPES = ["mobile", "pc", "console", "company"]


# ─── Single API call ──────────────────────────────────────────────────────────

def _do_search(
    keywords: list[str],
    entity_type: str,
    top: int,
    token: str,
    host: str,
    systems: str = "intelligence,dashboard,opinion",
) -> dict:
    """One POST to the search API; returns parsed body or raises.

    Returns:
        body dict (with body["code"] / body["data"]). Caller decides how to map.
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "keywords": keywords,
        "system": systems,
        "top": top,
    }
    if entity_type:
        payload["entity_type"] = entity_type

    url = f"{host.rstrip('/')}{SEARCH_PATH}"
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    check_http_auth(resp)
    resp.raise_for_status()
    return resp.json()


def _flatten_hits(body: dict, top: int) -> list[dict]:
    """Flatten API response (groups -> hits) into a flat list with normalized fields."""
    if body.get("code") != 0:
        return []

    results: list[dict] = []
    for group in body.get("data", []):
        keyword = group.get("keyword", "")
        hits = group.get("list", []) or []
        for hit in hits[:top]:
            entity_name = hit.get("entity_name", "") or hit.get("entity_name_ch", "")
            entity_type = hit.get("entity_type", "")
            mobile_id = hit.get("mobile_id", "") or ""
            pc_id = hit.get("pc_id", "") or ""
            console_id = hit.get("console_id", "") or ""
            combine_id = hit.get("combine_id", "") or ""
            entity_id = hit.get("entity_id", "") or ""

            # game_id 顶层兼容字段：等价于 unified_edition_id
            # 优先级 mobile_id > pc_id > console_id > entity_id（公司）
            game_id = mobile_id or pc_id or console_id or entity_id or hit.get("game_id", "")

            results.append({
                "keyword":        keyword,
                "entity_name":    entity_name,
                "entity_name_ch": hit.get("entity_name_ch", ""),
                "game_name":      hit.get("game_name", ""),
                "entity_type":    entity_type,
                # ─ 5 类 ID 全保留 ─
                "game_id":        game_id,        # = unified_edition_id（顶层兼容）
                "mobile_id":      mobile_id,      # = unified_id (u...)
                "pc_id":          pc_id,          # = edition_id (e...)
                "console_id":     console_id,     # = edition_id (e...)
                "combine_id":     combine_id,     # = combined_id (c...)
                "entity_id":      entity_id,      # 公司 UUID
                # ─ 元信息 ─
                "release_time":   hit.get("release_time", ""),
                "match_score":    hit.get("match_score", 0),
            })
    return results


# ─── 4-level string fallback wrapper ──────────────────────────────────────────

def _search_with_fallback(
    name: str,
    entity_type: str,
    top: int,
    token: str,
    host: str,
    systems: str,
) -> list[dict]:
    """For a SINGLE keyword, try up to 4 fallback strategies until non-empty.

    Strategy 1: 原样
    Strategy 2: lowercase
    Strategy 3: 首词 (handles "Genshin Impact" → "genshin")
    Strategy 4: 若 entity_type 为空，逐个尝试 mobile/pc/console/company
    """
    # Strategy 1
    body = _do_search([name], entity_type, top, token, host, systems)
    hits = _flatten_hits(body, top)
    if hits:
        return hits

    # Strategy 2
    lower_name = name.lower()
    if lower_name != name:
        body = _do_search([lower_name], entity_type, top, token, host, systems)
        hits = _flatten_hits(body, top)
        if hits:
            return hits

    # Strategy 3
    parts = name.split()
    first_word = parts[0].lower() if parts else lower_name
    if first_word and first_word != lower_name and len(first_word) >= 3:
        body = _do_search([first_word], entity_type, top, token, host, systems)
        hits = _flatten_hits(body, top)
        if hits:
            return hits

    # Strategy 4
    if not entity_type:
        for etype in AUTO_FALLBACK_TYPES:
            for query in (lower_name, first_word):
                if not query or (query == first_word and first_word == lower_name):
                    continue
                body = _do_search([query], etype, top, token, host, systems)
                hits = _flatten_hits(body, top)
                if hits:
                    return hits
            # 也试一下原样
            body = _do_search([name], etype, top, token, host, systems)
            hits = _flatten_hits(body, top)
            if hits:
                return hits

    return []


# ─── Public API ───────────────────────────────────────────────────────────────

def search_entity(
    keywords: list[str] | str,
    entity_type: str = "",
    top: int = 1,
    host: str = "",
    systems: str = "intelligence,dashboard,opinion",
) -> dict:
    """Resolve game/company name(s) → DataBrain IDs.

    Args:
        keywords:    Single name (str) or list of names. Each is resolved independently.
        entity_type: ""(auto-fallback) | "mobile" | "pc" | "console" | "company"
        top:         Max candidates per keyword (default 1).
        host:        Override host. Empty = read from env / default.
        systems:     API "system" parameter (default cover intelligence+dashboard+opinion).

    Returns:
        {"games": [{...}, ...]}                 # top == 1 path: flat hit dicts
        OR
        {"games": [{"keyword": ..., "candidates": [...]}, ...]}  # top > 1 path
        OR
        {"error": {"code": ..., "message": ...}}
    """
    if isinstance(keywords, str):
        keywords = [keywords]
    keywords = [k.strip() for k in keywords if (k or "").strip()]
    if not keywords:
        return {"error": {"code": "INVALID_INPUT", "message": "no keywords provided"}}

    token = require_token()
    target_host = (host or DEFAULT_HOST).rstrip("/")

    games: list[dict] = []
    for kw in keywords:
        try:
            hits = _search_with_fallback(kw, entity_type, top, token, target_host, systems)
        except requests.HTTPError as e:
            return {
                "error": {
                    "code": "HTTP",
                    "message": f"HTTP error for '{kw}': {e}",
                }
            }
        except requests.RequestException as e:
            return {
                "error": {
                    "code": "REQUEST",
                    "message": f"Request failed for '{kw}': {e}",
                }
            }

        if not hits:
            games.append({"keyword": kw, "game_id": None, "error": "no results found"})
            continue

        if top == 1:
            # 直接展开第一条（保留 keyword 字段以便上游对齐）
            first = dict(hits[0])
            first.setdefault("keyword", kw)
            games.append(first)
        else:
            games.append({"keyword": kw, "candidates": hits})

    return {"games": games}


# 向后兼容别名：旧调用 `from game_search import search_games` 仍可用
search_games = search_entity


# ─── CLI ──────────────────────────────────────────────────────────────────────

def _format_hit(r: dict) -> str:
    """Pretty-print a single hit (human-readable)."""
    etype = (r.get("entity_type") or "").lower()
    lines = []
    if r.get("keyword"):
        lines.append(f"keyword:      {r['keyword']}")
    lines.append(f"entity_name:  {r.get('entity_name', '')}")
    if r.get("entity_name_ch") and r["entity_name_ch"] != r.get("entity_name"):
        lines.append(f"entity_name_ch: {r['entity_name_ch']}")
    if r.get("game_name") and r["game_name"] != r.get("entity_name"):
        lines.append(f"game_name:    {r['game_name']}")
    lines.append(f"entity_type:  {etype or '(unknown)'}")

    # 顶层 game_id（= unified_edition_id）
    if r.get("game_id"):
        lines.append(f"game_id:      {r['game_id']}   # = unified_edition_id (舆情主表过滤键)")

    # 各端 ID（按存在性输出）
    if r.get("mobile_id"):
        lines.append(f"mobile_id:    {r['mobile_id']}   # = unified_id (手游店 store_score_app_store_* / google_play_*)")
    if r.get("pc_id"):
        lines.append(f"pc_id:        {r['pc_id']}   # = edition_id (PC 店 store_score_steam_*)")
    if r.get("console_id"):
        lines.append(f"console_id:   {r['console_id']}   # = edition_id (Console 店 playstation/xbox)")
    if r.get("combine_id"):
        lines.append(f"combine_id:   {r['combine_id']}   # = combined_id (本舆情 skill 一般不直接用)")
    if etype == "company" and r.get("entity_id"):
        lines.append(f"entity_id:    {r['entity_id']}   # 公司 UUID")

    if r.get("release_time"):
        lines.append(f"release_time: {r['release_time']}")
    if r.get("match_score") is not None:
        lines.append(f"match_score:  {r['match_score']}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Resolve game/company name(s) → DataBrain IDs via ChatBI search API.",
    )
    parser.add_argument(
        "names",
        nargs="+",
        help="One or more name keywords (case-insensitive). Pass batch for multi-game queries.",
    )
    parser.add_argument(
        "--type",
        dest="entity_type",
        default="",
        choices=["mobile", "pc", "console", "company", ""],
        help="Entity type filter. Leave empty to auto-fallback through mobile/pc/console/company.",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=1,
        help="Number of candidates per keyword (default 1). Use >1 when name is ambiguous.",
    )
    parser.add_argument(
        "--entity-type",
        dest="legacy_entity_type",
        default=None,
        help="[Deprecated alias] same as --type. Kept for backward compatibility.",
    )
    parser.add_argument(
        "--systems",
        default="intelligence,dashboard,opinion",
        help="Comma-separated DataBrain systems to search across.",
    )
    parser.add_argument(
        "--host",
        default="",
        help="Override host (else read DATABRAIN_HOST env or default).",
    )

    args = parser.parse_args()

    # 兼容旧 --entity-type 写法（接受 'pc,console,mobile' 这类组合 → 取第一个；不是 4 类有效值则回退到 auto-fallback）
    if args.legacy_entity_type and not args.entity_type:
        first = args.legacy_entity_type.split(",")[0].strip().lower()
        if first in ("mobile", "pc", "console", "company"):
            args.entity_type = first

    result = search_entity(
        keywords=args.names,
        entity_type=args.entity_type,
        top=args.top,
        host=args.host,
        systems=args.systems,
    )

    output_json = bool(os.environ.get("OUTPUT_JSON"))

    if "error" in result:
        if output_json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"Error: {json.dumps(result['error'], ensure_ascii=False)}", file=sys.stderr)
        return 1

    if output_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    # Human-readable rendering
    games = result.get("games", [])
    for i, g in enumerate(games):
        if i > 0:
            print("---")
        if g.get("error"):
            print(f"keyword:      {g.get('keyword', '')}")
            print(f"error:        {g['error']}")
            print("Tips:")
            print("  - 名字可尝试小写 / 首词（脚本已内置回退，但仍可能命中不到）")
            print("  - 公司/工作室建议加 --type company")
            print("  - 最终 fallback：用 SQL LIKE 查 common.app_detail 或 common.company_details")
            continue
        if "candidates" in g:
            print(f"keyword:      {g.get('keyword', '')}")
            print(f"candidates ({len(g['candidates'])}):")
            for j, c in enumerate(g["candidates"]):
                if j > 0:
                    print("  ---")
                for line in _format_hit(c).splitlines():
                    print(f"  {line}")
        else:
            print(_format_hit(g))

    # Always emit JSON tail for programmatic consumers
    if not output_json:
        print("\n--- JSON ---")
        print(json.dumps(result, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
