#!/usr/bin/env python3
"""
Search DataBrain entities (games OR companies) using the Intelligence Search API.

这个脚本既能按**游戏名**搜游戏（返回 unified_id / edition_id / combined_id），
也能按**公司/开发商/发行商名**搜公司（返回 entity_id），用于后续按 developer /
publisher 的聚合查询或直接访问 DataBrain 公司详情页。

Token 来源（优先级从高到低）：
  1. 命令行参数 --token / search_entity(token=...)（暂不暴露 CLI --token）
  2. 系统环境变量 DATABRAIN_TOKEN（生产由服务端自动注入）
  3. skill 根目录 .env 中的 DATABRAIN_TOKEN（本地调试）
  4. 旧的 TAI_IT_TOKEN 环境变量 / .env（兼容 fallback）

Usage:
    # 游戏
    python scripts/search_entity.py --name "PUBG Mobile"
    python scripts/search_entity.py --name "Counter-Strike 2" --type pc
    python scripts/search_entity.py --name "王者荣耀" --type mobile --top 3

    # 公司 / 开发商 / 发行商（例如 SYBO、Tencent、miHoYo）
    python scripts/search_entity.py --name "SYBO" --type company
    python scripts/search_entity.py --name "腾讯" --type company --top 3

    # 不知道是游戏还是公司 → 不传 --type，脚本会自动按 mobile/pc/console/company 逐个回退
    python scripts/search_entity.py --name "SYBO"

Entity type → ID 字段映射（查对应 DataBrain 数据表时使用）：
    mobile   → mobile_id (= unified_id, 前缀 u)     # *_uid 表
    pc       → pc_id     (= edition_id,  前缀 e)    # gamalytic_daily 等
    console  → console_id(= edition_id,  前缀 e)    # ampere_daily_cid 等
    combined → combine_id(= combined_id, 前缀 c)    # *_cid 表、三端聚合
    company  → entity_id (UUID)                     # common.company_details / 公司详情页

This script is a backward-compatible replacement of the old `search_game.py`.
The import alias `search_game` is kept so legacy callers keep working.
"""
import argparse
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "-q"])
    import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _utils import get_host, require_token

DEFAULT_HOST = get_host()
SEARCH_PATH = "/api/v1/intelligence_pc/chatbi/search"

# 不指定 entity_type 时，自动回退尝试的顺序
AUTO_FALLBACK_TYPES = ["mobile", "pc", "console", "company"]


def _do_search(name: str, entity_type: str, top: int, token: str, host: str = DEFAULT_HOST) -> list:
    """Single API call. Returns list of match dicts."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "keywords": [name],
        "system": "intelligence",
        "top": top,
    }
    if entity_type:
        payload["entity_type"] = entity_type

    url = f"{host.rstrip('/')}{SEARCH_PATH}"
    resp = requests.post(url, headers=headers, json=payload, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    if data.get("code") != 0:
        return []

    results = []
    for group in data.get("data", []):
        for item in group.get("list", []):
            results.append({
                "entity_name": item.get("entity_name", "") or item.get("entity_name_ch", ""),
                "game_name": item.get("game_name", ""),
                "entity_type": item.get("entity_type", ""),
                "entity_id": item.get("entity_id", ""),       # 公司主要用这个（UUID）
                "mobile_id": item.get("mobile_id", ""),       # = unified_id for _uid tables
                "pc_id": item.get("pc_id", ""),               # = edition_id for Gamalytic
                "console_id": item.get("console_id", ""),     # = edition_id for console tables
                "combine_id": item.get("combine_id", ""),     # = combined_id for _cid tables
                "match_score": item.get("match_score", 0),
            })
    return results


def search_entity(name: str, entity_type: str = "", top: int = 1, host: str = DEFAULT_HOST) -> list:
    """Search for a game OR company by name, with automatic retry strategies.

    API 小坑：长全名（如 "Genshin Impact"）可能命中 0 条，但小写 / 首词 + entity_type
    往往能匹配上。本函数会按多个策略自动回退：

        Strategy 1  原样
        Strategy 2  lowercase
        Strategy 3  首个单词（处理 "Genshin Impact" → "genshin"）
        Strategy 4  未指定 entity_type 时，逐个尝试 mobile / pc / console / company

    当关键词明显是公司名时，建议直接传 entity_type="company"，比自动回退快。
    """
    token = require_token()

    # Strategy 1: exact name as-is
    results = _do_search(name, entity_type, top, token, host)
    if results:
        return results

    # Strategy 2: lowercase
    lower_name = name.lower()
    if lower_name != name:
        results = _do_search(lower_name, entity_type, top, token, host)
        if results:
            return results

    # Strategy 3: first word only (handles "Genshin Impact" → "genshin")
    first_word = name.split()[0].lower() if name.split() else name
    if first_word != lower_name and len(first_word) >= 3:
        results = _do_search(first_word, entity_type, top, token, host)
        if results:
            return results

    # Strategy 4: if no entity_type specified, try each type (mobile/pc/console/company)
    if not entity_type:
        for etype in AUTO_FALLBACK_TYPES:
            results = _do_search(lower_name, etype, top, token, host)
            if results:
                return results
            if first_word != lower_name:
                results = _do_search(first_word, etype, top, token, host)
                if results:
                    return results

    return []


# 向后兼容别名 —— 旧代码里 `from search_game import search_game` 的调用还能走通
search_game = search_entity


def _format_result(r: dict) -> str:
    """根据 entity_type 智能格式化，只打印有意义的字段。"""
    etype = (r.get("entity_type") or "").lower()
    lines = []
    lines.append(f"entity_name:  {r['entity_name']}")
    if r.get("game_name") and r["game_name"] != r["entity_name"]:
        lines.append(f"game_name:    {r['game_name']}")
    lines.append(f"entity_type:  {etype or '(unknown)'}")

    # 按 entity_type 打印关键 ID
    if etype == "company":
        lines.append(f"entity_id:    {r.get('entity_id', '')}   # 用于 common.company_details / 公司详情页")
    else:
        # 游戏：列出所有存在的 ID
        if r.get("mobile_id"):
            lines.append(f"mobile_id:    {r['mobile_id']}   # = unified_id (*_uid 表)")
        if r.get("pc_id"):
            lines.append(f"pc_id:        {r['pc_id']}   # = edition_id (gamalytic_daily 等)")
        if r.get("console_id"):
            lines.append(f"console_id:   {r['console_id']}   # = edition_id (ampere_daily_cid 等)")
        if r.get("combine_id"):
            lines.append(f"combine_id:   {r['combine_id']}   # = combined_id (*_cid 表)")
        if r.get("entity_id"):
            lines.append(f"entity_id:    {r['entity_id']}")
    lines.append(f"match_score:  {r['match_score']}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Search DataBrain entities (games OR companies) by name",
    )
    parser.add_argument("--name", required=True, help="Entity name (game OR company) to search")
    parser.add_argument("--type", dest="entity_type", default="",
                        choices=["mobile", "pc", "console", "company", ""],
                        help="Entity type filter. Leave empty to auto-fallback through all types.")
    parser.add_argument("--top", type=int, default=1, help="Max results per keyword (default: 1)")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"API host (default: {DEFAULT_HOST})")
    args = parser.parse_args()

    results = search_entity(args.name, args.entity_type, args.top, args.host)

    if not results:
        print("No results found. Tips:")
        print("  - 游戏名可尝试小写 / 首词（脚本已内置回退，但仍可能命中不到）")
        print("  - 公司名强烈建议加 --type company，例如 --name 'SYBO' --type company")
        print("  - 最终 fallback：用 SQL LIKE 查 common.app_detail (游戏) 或 common.company_details (公司)")
        sys.exit(1)

    for i, r in enumerate(results):
        if i > 0:
            print("---")
        print(_format_result(r))

    # Also output JSON for programmatic use
    if os.environ.get("OUTPUT_JSON"):
        print("\n--- JSON ---")
        print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
