"""
Topic Selection Service — split-LLM topic selection with exactly 2 parallel calls.

Call 1 (Topic Selector):  query + per-game topic catalogs  → per-game selected_topics dict
Call 2 (Keyword Extractor): query only                     → shared extracted_keywords list

Output:
    {
        "MLBB": ["外挂通用", "雷达挂"],
        "CODM": ["作弊"],
        "query_keywords": ["外挂"],
    }
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any, Dict, List, Sequence

from loguru import logger

from opinion_utils.llm_proxy import request_llm

_ZH_RE = re.compile(r"[\u4e00-\u9fff]+")
_EN_RE = re.compile(r"[a-z0-9]+")

_FALLBACK_MODEL = "gpt-4.1"


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------

def _normalize_text(value: Any) -> str:
    # 去除leading和trailing空格然后把text变成小写
    text = str(value or "").strip().lower()
    if not text:
        return ""
    # 替换引号
    text = text.replace("\u201c", '"').replace("\u201d", '"').replace("\u2018", "'").replace("\u2019", "'")
    # 提取中文字符
    zh_tokens = _ZH_RE.findall(text)
    # 提取英文单词
    en_tokens = _EN_RE.findall(text)
    return " ".join([*zh_tokens, *en_tokens]).strip()

# 去重并保留顺序
def _dedupe_preserve_order(items: Sequence[str]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for item in items:
        normalized = item.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


# 去除json fence
def _strip_json_fence(text: str) -> str:
    content = text.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1]).strip()
    return content


def _is_chinese_language(language: str) -> bool:
    normalized = str(language or "").strip().lower()
    return normalized.startswith("zh") or normalized == "chinese"


# ---------------------------------------------------------------------------
# Topic list flattener
# ---------------------------------------------------------------------------

def _flatten_game_topics(
    topics_dict: Dict[str, list],
    language: str = "english",
) -> List[str]:
    """Convert {parent_key: [{topic, topic_zh}, ...]} to flat list."""
    flat: List[str] = []
    for subtopics in topics_dict.values():
        if not isinstance(subtopics, list):
            continue
        for entry in subtopics:
            if not isinstance(entry, dict):
                continue
            # 如果语言是中文，则使用中文topic，否则使用英文topic
            if _is_chinese_language(language):
                label = entry.get("topic_zh") or entry.get("topic", "")
            else:
                label = entry.get("topic") or entry.get("topic_zh", "")
            label = str(label).strip()
            if label:
                flat.append(label)
    return _dedupe_preserve_order(flat)


def _build_topic_alias_map(
    topics_dict: Dict[str, list],
    language: str = "english",
) -> Dict[str, str]:
    """Map bilingual aliases back to one canonical label for the current query language."""
    alias_map: Dict[str, str] = {}
    prefer_chinese = _is_chinese_language(language)

    for subtopics in topics_dict.values():
        if not isinstance(subtopics, list):
            continue
        for entry in subtopics:
            if not isinstance(entry, dict):
                continue
            topic_en = str(entry.get("topic") or "").strip()
            topic_zh = str(entry.get("topic_zh") or "").strip()
            preferred = topic_zh if prefer_chinese and topic_zh else (topic_en or topic_zh)
            if not preferred:
                continue

            for alias in (preferred, topic_zh, topic_en):
                normalized = _normalize_text(alias)
                if normalized:
                    alias_map[normalized] = preferred

    return alias_map


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _build_topic_selector_prompt(
    query: str,
    target_game_text: str,
    per_game_topics: Dict[str, List[str]],
    max_topics: int,
    language: str,
) -> str:
    target_game_text = target_game_text or "(unknown)"
    catalog_language = "Chinese" if _is_chinese_language(language) else "English"

    catalog_sections: List[str] = []
    for game_name, topics in per_game_topics.items():
        topics_text = "\n".join(f"- {t}" for t in topics) if topics else "(empty)"
        catalog_sections.append(f"[{game_name}]\n{topics_text}")
    all_catalogs = "\n\n".join(catalog_sections) if catalog_sections else "(empty)"

    game_names_list = list(per_game_topics.keys())
    output_template = json.dumps(
        {name: [] for name in game_names_list},
        ensure_ascii=False,
    )

    return f"""You are a professional game-opinion topic selector.

Task:
- Decide whether the user query names a valid game-discussion focus that can be faithfully preserved by the topic catalog below.
- Return `selected_topics` containing only items copied EXACTLY from each game's catalog.
- It is valid to return an empty list for any or all games.
- You MUST return a JSON object with one key per game. Each key maps to a list of selected topics for that game.

Target Games Context:
- Recognized target game(s): {target_game_text}
- Each game has its own topic catalog listed below.
- The topic catalogs below are already normalized to {catalog_language}.
- A target game name that is acting only as search scope is not itself a topic.
- If a named entity is functioning as the discussed counterpart/content object, it may define the real anchor, but you should still output it only when an exact catalog topic preserves that anchor.

Topic Selector Taxonomy

Topic `Should Take`:
- `exact_catalog_topic`: the real focus and the catalog topic are semantically equivalent with no meaning loss.
- `aligned_specific_subtopic`: the exact phrase is not in catalog, but one or two specific child topics preserve the focus faithfully.
- `exact_dimension_topic`: the query directly names a discussion dimension and the catalog has the same dimension at usable granularity.

Topic `Should Not Take`:
- `scope_only_game_name`: the item is only the target-game search scope.
- `missing_compound_anchor`: the real anchor is a compound focus, but the catalog only offers a broader parent topic.
- `bare_relation_topic`: the query names a concrete counterpart, but the catalog candidate is only a bare relation such as `联动` or `IP 联动`.
- `reporting_or_analysis_topic`: the candidate only reflects reporting, sentiment summary, business framing, or analysis intent.
- `broad_parent_topic`: the candidate is a parent bucket that drops important constraints from the query.

Topic Selector Rules:
- Copy the topic text EXACTLY from the list. No paraphrasing or generalization.
- Do NOT translate a catalog topic into another language. Keep the exact surface form shown in the catalog.
- First identify the real user focus. Then classify candidate outputs using the taxonomy above.
- Only output topics that fall under Topic `Should Take`.
- Never output items that fall under Topic `Should Not Take`.
- Do not infer an issue/problem/negative variant unless the query explicitly names an issue signal such as `bug`, `问题`, `崩溃`, `报错`, `故障`, `负面`.
- Wrapper words like `讨论`, `反馈`, `评论`, `表现` do not justify selecting an issue-labeled topic such as `问题`, `Bug`, or `负面`.

- Never broaden a narrow focus into a wider parent topic.
  - Not allowed: `indoor rain bug` -> `Bug & Issues`; `终局pvp` -> `PvP`; `策略` -> `游戏机制`.
- If one candidate preserves the decisive constraint and another candidate is only a broader sibling, keep only the more faithful one.
  - Not allowed: `终局pvp` -> `游戏终局` + `PvP`; `玩法反馈` -> `游戏玩法` + `游戏玩法问题`.
- Prefer specific child topics over broad parent topics when the child preserves the anchor more faithfully.
- If the only available catalog match is a bare relation or broad parent topic, return empty.
- Missing a weak match is better than forcing a loose or generic one.
- Return at most {max_topics} items per game.
- Each game's selected topics must come ONLY from that game's own catalog section. Never copy topics across games.

Examples:
- Query: "nikke 关于角色白雪公主的讨论 主要在讨论什么？"
  [nikke] Catalog: ["白雪公主", "蕾雯", "小红帽", "活动奖励", "抽卡贵"]
  Output: {{"nikke": ["白雪公主"]}}
  reason: `exact_catalog_topic` because `白雪公主` preserves the concrete anchor and already matches the Chinese catalog surface form.
- Query: "nikke monetization issues lately?"
  [nikke] Catalog: ["Monetization", "Pay-to-win", "Pricing", "角色剧情"]
  Output: {{"nikke": ["Monetization"]}}
  reason: `exact_catalog_topic` because `Monetization` is the same discussion focus the user explicitly asked about.
- Query: "GameX 战利品系统的反馈"
  [GameX] Catalog: ["掉落", "奖励"]
  Output: {{"GameX": ["掉落", "奖励"]}}
  reason: `aligned_specific_subtopic` because the exact phrase is missing, but `掉落` and `奖励` are specific child topics that preserve the loot-system focus.
- Query: "Dying Light: The Beast 室内下雨的bug 相关的讨论"
  [Dying Light: The Beast] Catalog: ["[USP] Bug & Issues", "敌人", "刷资源", "游戏玩法"]
  Output: {{"Dying Light: The Beast": []}}
  reason: `missing_compound_anchor` + `broad_parent_topic` because `[USP] Bug & Issues` drops the concrete modifier in `室内下雨bug`.
- Query: "GameX 服务器和登录问题多吗？"
  [GameX] Catalog: ["服务器", "登录", "账号登陆", "断线", "网络延迟"]
  Output: {{"GameX": ["服务器", "登录", "账号登陆"]}}
  reason: `exact_dimension_topic` because the query directly names server/login dimensions that the catalog exposes at the same usable granularity.
- Query: "返回dltb关于终局pvp的代表性评论？"
  [dltb] Catalog: ["游戏终局", "PvP", "PvE", "游戏模式"]
  Output: {{"dltb": ["游戏终局"]}}
  reason: `aligned_specific_subtopic` because `游戏终局` preserves the endgame constraint, while bare `PvP` would be `missing_compound_anchor`.
- Query: "mlbb和火影的联动，玩家反馈如何?"
  [mlbb] Catalog: ["联动", "IP 联动", "活动", ...]
  Output: {{"mlbb": []}}
  reason: `bare_relation_topic` because the real focus is a counterpart-specific collaboration, while bare `联动` / `IP 联动` are too broad.
- Query: "2026 年《世界之外》在各平台，玩家对抽卡价格和活动奖励的负面反馈差异？"
  [世界之外] Catalog: ["活动奖励", "抽卡贵", "角色剧情"]
  Output: {{"世界之外": ["活动奖励", "抽卡贵"]}}
  reason: `exact_catalog_topic` for `活动奖励` and `aligned_specific_subtopic` for `抽卡贵`; time/platform/sentiment framing is not the real topic.
- Query: "三角洲最近半年的外挂讨论走势？以及有什么外挂？"
  [三角洲] Catalog: ["雷达挂", "外挂通用", "子弹追踪", ...]
  Output: {{"三角洲": ["外挂通用", "子弹追踪", "雷达挂"]}}
  reason: `exact_dimension_topic` for `外挂通用` and `aligned_specific_subtopic` for concrete cheat types that faithfully operationalize the cheat discussion focus.
- Query: "FreeFire 和 CODM 在玩家评论中有多少会提到游戏的策略以及玩法深度？"
  [FreeFire] Catalog: ["游戏机制", "游戏模式", ...]
  [CODM] Catalog: ["游戏机制", "枪械平衡", ...]
  Output: {{"FreeFire": [], "CODM": []}}
  reason: `broad_parent_topic` because `游戏机制` is broader than the explicitly named dimensions `策略` and `玩法深度`.
- Query: "逆战未来、穿越火线手游、无畏契约源能行动上线一个月的舆论表现（含下载量、收入、评分配套）"
  [逆战未来] Catalog: ["下载错误", "商业化", "竞品对比", ...]
  [穿越火线手游] Catalog: ["游戏模式", "枪械", ...]
  [无畏契约] Catalog: ["游戏平衡", "角色技能", ...]
  Output: {{"逆战未来": [], "穿越火线手游": [], "无畏契约": []}}
  reason: `reporting_or_analysis_topic` because the query asks for reporting/business framing rather than a concrete discussion anchor.
- Query: "MLBB 和 CODM 的外挂情况，玩家讨论多吗？"
  [MLBB] Catalog: ["外挂通用", "雷达挂", "自瞄挂", "商业化"]
  [CODM] Catalog: ["作弊", "反作弊", "枪械平衡"]
  Output: {{"MLBB": ["外挂通用", "雷达挂", "自瞄挂"], "CODM": ["作弊", "反作弊"]}}
  reason: `exact_dimension_topic` — both games have cheat-related topics that faithfully preserve the focus; each game's output comes only from its own catalog.
- Query: "AOV wants to understand competitor MLBB monetization discussion lately"
  [AOV] Catalog: ["Hero Balance", "Matchmaking", "Skins"]
  [MLBB] Catalog: ["Monetization", "Pay-to-win", "Skin Pricing", "Event Rewards"]
  Output: {{"AOV": [], "MLBB": ["Monetization"]}}
  reason: AOV is only the requester's scope, not the discussion target; MLBB's `Monetization` is `exact_catalog_topic` in the English catalog.

Output JSON only:
{output_template}

User Query:
{query}

Topic Catalogs (per game):
Target games = {target_game_text}
{all_catalogs}
"""


def _build_keyword_extractor_prompt(
    query: str,
    target_game_text: str,
    max_keywords: int,
) -> str:
    target_game_text = target_game_text or "(unknown)"
    return f"""You are a professional game-opinion keyword extractor.

Task:
- Extract query-grounded anchors from the user query that can be used to search discussion about the recognized target game(s).
- Return `extracted_keywords` containing only query-grounded issue/content phrases, concrete entities, or gameplay/design dimension labels.
- It is valid to return an empty list.

Target Games Context:
- Recognized target game(s): {target_game_text}
- Do not switch focus to unrelated games just because the query mentions comparisons, competitors, or IPs.

- A target game name that is acting only as search scope is not itself a keyword.
- If a named entity is functioning as the discussed counterpart/content object, it may be a valid keyword.

Keyword Extractor Taxonomy

Keyword `Should Take`:
- `compound_anchor_phrase`: a complete query-grounded content phrase that should not be split or downgraded.
- `explicit_gameplay_dimension`: a directly named gameplay/design dimension that is itself a valid discussion anchor.
- `concrete_content_entity`: a named character, IP, collab counterpart, item, or other content entity that is part of the discussion.
- `query_grounded_surface_variant`: a high-confidence surface-form variant or bilingual form that stays very close to the query anchor.

Keyword `Should Not Take`:
- `scope_only_game_name`: the item is only the target-game search scope.
- `wrapper_phrase`: words like `讨论`, `反馈`, `评论`, `代表性评论`, `表现`, `情况`, `舆情` that wrap the question but are not the anchor.
- `reporting_or_business_wrapper`: downloads, revenue, rating, trend, implication, ratios, or other reporting/business framing.
- `slice_or_filter_dimension`: time, region, platform, channel, source, and similar slicing conditions.
- `source_or_channel_name`: source/community/channel names such as `Facebook`, `Instagram`, `YouTube`, `Reddit`, `Discord`, `贴吧`, `论坛` that define where data comes from, not what the discussion is about.
- `chart_or_output_instruction`: line chart, percentage chart, distribution chart, and other output formatting requests.
- `analysis_goal`: requests about concentration, downstream impact, comparison framing, or other analysis intent.
- `sentiment_or_stance_label`: words such as `表扬`, `吐槽`, `夸`, `骂`, `positive`, `negative`, `praise`, `complaint` that describe the opinion lens rather than the content anchor.
- `lossy_parent_word`: a broad parent word that drops specificity from a narrower query phrase.
- `bare_relation_word`: a relation-only word such as `联动` when the query already names a concrete counterpart-specific relation.

Keyword Extraction Rules:
- First strip all `Should Not Take` items conceptually, then keep only the surviving anchors.
- Extract complete issue/content phrases when they preserve the user's wording more faithfully than a shorter word.
- Do NOT treat gameplay-discussion dimensions (`策略`, `玩法深度`, `操作手感`, `skill expression`) as reporting or business labels.
- Do NOT treat source/community/channel names as keywords. They are only data-source filters.
- Do NOT treat opinion stance words such as `表扬`, `吐槽`, `夸`, `骂`, `positive`, or `negative` as keywords. They describe the evaluative lens, not the topic anchor.
- If a narrower phrase exists, do NOT replace it with a broader parent word.
  - Not allowed: `indoor rain bug` -> `bug`; `终局pvp` -> `pvp`.
- If relation + counterpart is explicit, do NOT keep only the bare relation word.
  - Prefer `火影联动` or `火影` over bare `联动`.
- Strip generic discussion wrappers when they only wrap the same anchor.
  - Prefer `终局` over `终局讨论`; prefer `玩法` over `玩法反馈`.
- Keep keywords grounded in the user's wording. Do not invent loose synonyms or unrelated expansions.
- Return at most {max_keywords} items.

Examples:
- Query: "nikke 关于角色白雪公主的讨论 主要在讨论什么？"
  extracted_keywords: ["白雪公主"]
  reason: `concrete_content_entity` because `白雪公主` is the actual named content object being discussed.
- Query: "Dying Light: The Beast 室内下雨的bug 相关的讨论"
  extracted_keywords: ["室内下雨", "indoor rain", "室内下雨bug"]
  reason: `compound_anchor_phrase` for `室内下雨bug` and `query_grounded_surface_variant` for `室内下雨` / `indoor rain`; `bug` would be `lossy_parent_word`.
- Query: "返回dltb关于终局pvp的代表性评论？"
  extracted_keywords: ["终局pvp"]
  reason: `compound_anchor_phrase` because `终局pvp` is the full search anchor; bare `pvp` would be `lossy_parent_word`.
- Query: "mlbb和火影的联动，玩家反馈如何?"
  extracted_keywords: ["火影联动", "火影", "Naruto"]
  reason: `compound_anchor_phrase` for `火影联动`, `concrete_content_entity` for `火影`, and `query_grounded_surface_variant` for `Naruto`; `mlbb` would be `scope_only_game_name` and bare `联动` would be `bare_relation_word`.
- Query: "玩家对DLTB的终局讨论？"
  extracted_keywords: ["终局"]
  reason: `explicit_gameplay_dimension` because `终局` is the real anchor after removing the `wrapper_phrase` `讨论`.
- Query: "玩家对Anno 117的玩法反馈如何？"
  extracted_keywords: ["玩法"]
  reason: `explicit_gameplay_dimension` because `玩法` is the real anchor after removing the `wrapper_phrase` `反馈`.
- Query: "2026 年《世界之外》在各平台的负面舆情主要集中在哪些话题？这些负面反馈对游戏后续运营和口碑有何潜在影响？"
  extracted_keywords: []
  reason: `slice_or_filter_dimension` + `analysis_goal` because only slicing, sentiment framing, and analysis intent remain after stripping wrappers.
- Query: "FreeFire 和 CODM 在玩家评论中有多少会提到游戏的策略以及玩法深度？玩家怎么看待这两个游戏的策略？"
  extracted_keywords: ["策略", "玩法深度"]
  reason: `explicit_gameplay_dimension` because both dimensions are directly named by the user as the discussion focus.
- Query: "我想知道巴西 FF 玩家中，2023-2025 年的 Facebook,Instagram,Youtube 渠道的玩家评论中关于"策略"以及"玩法深度"的讨论，在所有的话题中占比多少？"
  extracted_keywords: ["策略", "玩法深度"]
  reason: `explicit_gameplay_dimension` because `策略` and `玩法深度` are the real anchors; `巴西`, `2023-2025`, and `Facebook/Instagram/Youtube` are only `slice_or_filter_dimension` or `source_or_channel_name`.
- Query: "玩家对poe2最新赛季的反馈如何？主要在表扬和吐槽什么？"
  extracted_keywords: []
  reason: `sentiment_or_stance_label` because `表扬` and `吐槽` describe stance, while `最新赛季` here acts as broad scope rather than a concrete searchable content anchor.
- Query: "巴西 FreeFire 玩家高频关键词出现频率占比，需折线图呈现"
  extracted_keywords: []
  reason: `reporting_or_business_wrapper` + `chart_or_output_instruction` because the query asks for reporting output, not a content anchor.
- Query: "战利品系统的反馈"
  extracted_keywords: ["战利品系统"]
  reason: `compound_anchor_phrase` because `战利品系统` is a complete query-grounded content phrase that should be searched as-is.
- Query: "三角洲最近半年的外挂讨论走势？以及有什么外挂？"
  extracted_keywords: ["外挂"]
  reason: `explicit_gameplay_dimension` because `外挂` is the directly named discussion dimension; `走势` is only `reporting_or_business_wrapper`.
- Query: "what's the implication for wild rift publishing campaign"
  extracted_keywords: ["publishing campaign", "campaign"]
  reason: `compound_anchor_phrase` for `publishing campaign`; `campaign` is an allowed `query_grounded_surface_variant`, while `implication` is only `reporting_or_business_wrapper`.
- Query: "逆战未来、穿越火线手游、无畏契约源能行动上线一个月的舆论表现（含下载量、收入、评分配套）"
  extracted_keywords: []
  reason: `scope_only_game_name` + `reporting_or_business_wrapper` because only game-scope names and business/reporting framing remain.

Output JSON only:
{{
  "extracted_keywords": []
}}

User Query:
{query}
"""


# ---------------------------------------------------------------------------
# Output parsers
# ---------------------------------------------------------------------------

def _parse_topic_selector_output(
    raw_output: str,
    per_game_topic_alias_maps: Dict[str, Dict[str, str]],
) -> Dict[str, List[str]]:
    """Parse topic selector output and map aliases to canonical labels."""
    try:
        payload = json.loads(_strip_json_fence(raw_output))
    except Exception:
        payload = {}

    if not isinstance(payload, dict):
        payload = {}

    result: Dict[str, List[str]] = {}
    for game_name, topic_alias_map in per_game_topic_alias_maps.items():
        raw_items = payload.get(game_name, [])
        if not isinstance(raw_items, list):
            raw_items = []
        matched: List[str] = []
        for item in raw_items:
            normalized = _normalize_text(item)
            if normalized and normalized in topic_alias_map:
                matched.append(topic_alias_map[normalized])
        result[game_name] = _dedupe_preserve_order(matched)
    return result


def _parse_keyword_extractor_output(raw_output: str) -> List[str]:
    try:
        payload = json.loads(_strip_json_fence(raw_output))
    except Exception:
        payload = {}

    items = payload.get("extracted_keywords", []) or payload.get("expanded_keywords", []) or []
    if not isinstance(items, list):
        return []
    return [str(x).strip() for x in items if str(x).strip()]


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------

def _finalize_outputs(
    per_game_topics: Dict[str, List[str]],
    shared_keywords: List[str],
    per_game_topic_alias_maps: Dict[str, Dict[str, str]],
    max_topics: int,
    max_keywords: int,
) -> Dict[str, List[str]]:
    """Catalog match, dedup, truncate. Topics and keywords kept separate."""

    finalized: Dict[str, List[str]] = {}
    all_selected_norms: set[str] = set()

    for game_name, items in per_game_topics.items():
        topic_alias_map = per_game_topic_alias_maps.get(game_name, {})
        raw_topics = [
            topic_alias_map[normalized]
            for item in items
            if (normalized := _normalize_text(item)) and normalized in topic_alias_map
        ]
        deduped = _dedupe_preserve_order(raw_topics)[:max_topics]
        finalized[game_name] = deduped
        selected_topic_set = set(deduped)
        all_selected_norms.update(
            alias_norm
            for alias_norm, canonical in topic_alias_map.items()
            if canonical in selected_topic_set
        )

    cleaned_keywords = _dedupe_preserve_order([
        val for kw in shared_keywords
        if (val := str(kw).strip(" \t\n\r\"'"))
    ])
    cleaned_keywords = [
        kw for kw in cleaned_keywords if _normalize_text(kw) not in all_selected_norms
    ][:max_keywords]

    finalized["query_keywords"] = cleaned_keywords
    return finalized


# ---------------------------------------------------------------------------
# LLM call with fallback
# ---------------------------------------------------------------------------

async def _call_llm_with_fallback(
    primary_model: str,
    llm_config_base: dict,
    request_id: str,
    prompt: str,
    system_prompt: str = "Return valid JSON only. Do not include markdown.",
) -> str:
    primary_config = {**llm_config_base, "model_name": primary_model}
    try:
        return await request_llm(
            llm_config=primary_config,
            request_id=f"{request_id}_primary",
            prompt=prompt,
            system_prompt=system_prompt,
        )
    except Exception as e:
        logger.warning(
            f"Primary model {primary_model} failed for {request_id}: {e}. "
            f"Retrying with fallback {_FALLBACK_MODEL}."
        )

    fallback_config = {**llm_config_base, "model_name": _FALLBACK_MODEL}
    try:
        return await request_llm(
            llm_config=fallback_config,
            request_id=f"{request_id}_fallback",
            prompt=prompt,
            system_prompt=system_prompt,
        )
    except Exception as e:
        logger.error(f"Fallback model {_FALLBACK_MODEL} also failed for {request_id}: {e}")
        return ""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def select_topics_for_query(
    query: str,
    game_names: List[str],
    topics_result: Dict[str, Dict],
    game_ids_dict: Dict[str, str],
    language: str = "english",
    model_name: str = "gemini-3-flash-preview-pt",
    max_selected_topics: int = 5,
    max_expanded_keywords: int = 5,
    timeout: int = 10,
    max_tokens: int = 256,
) -> Dict[str, List[str]]:
    """
    Select topics and extract keywords for a user query across multiple games.

    Returns:
        {
            "MLBB": ["外挂通用", "雷达挂"],   # per-game selected topics
            "CODM": ["作弊"],                  # per-game selected topics
            "query_keywords": ["外挂"],         # shared extracted keywords
        }
    """
    per_game_topic_alias_maps: Dict[str, Dict[str, str]] = {}
    games_with_topics: Dict[str, List[str]] = {}

    for game_name in game_names:
        game_id = game_ids_dict.get(game_name) or ""
        game_topics_dict = topics_result.get(game_id, {}) if game_id else {}
        if game_topics_dict:
            flat = _flatten_game_topics(game_topics_dict, language)
            per_game_topic_alias_maps[game_name] = _build_topic_alias_map(game_topics_dict, language)
            # Only add to games_with_topics when the catalog is non-empty;
            # an empty flat list means the Cube data has no sub-topics for this game,
            # so there's nothing for the topic selector to match against.
            if flat:
                games_with_topics[game_name] = flat
        else:
            per_game_topic_alias_maps[game_name] = {}

    logger.info(
        f"[select_topics_for_query] game_names={game_names} "
        f"game_ids_dict={game_ids_dict} "
        f"games_with_topics={list(games_with_topics.keys())} "
        f"(topics_result keys={list(topics_result.keys())})"
    )

    target_game_text = ", ".join(game_names) if game_names else "(unknown)"
    req_id = f"topic_sel_{uuid.uuid4().hex[:8]}"

    llm_config_base = {
        "temperature": 0,
        "timeout": timeout,
        "max_tokens": max_tokens,
    }

    async def call_topic_selector() -> Dict[str, List[str]]:
        if not games_with_topics:
            return {name: [] for name in game_names}
        prompt = _build_topic_selector_prompt(
            query=query,
            target_game_text=target_game_text,
            per_game_topics=games_with_topics,
            max_topics=max_selected_topics,
            language=language,
        )
        raw = await _call_llm_with_fallback(
            primary_model=model_name,
            llm_config_base=llm_config_base,
            request_id=f"{req_id}_topic",
            prompt=prompt,
        )
        if not raw:
            return {name: [] for name in game_names}
        parsed = _parse_topic_selector_output(raw, per_game_topic_alias_maps)
        result = {name: parsed.get(name, []) for name in game_names}
        return result

    async def call_keyword_extractor() -> List[str]:
        prompt = _build_keyword_extractor_prompt(
            query=query,
            target_game_text=target_game_text,
            max_keywords=max_expanded_keywords,
        )
        raw = await _call_llm_with_fallback(
            primary_model=model_name,
            llm_config_base=llm_config_base,
            request_id=f"{req_id}_kw",
            prompt=prompt,
        )
        if not raw:
            return []
        return _parse_keyword_extractor_output(raw)

    per_game_selected, shared_keywords = await asyncio.gather(
        call_topic_selector(),
        call_keyword_extractor(),
    )

    return _finalize_outputs(
        per_game_topics=per_game_selected,
        shared_keywords=shared_keywords,
        per_game_topic_alias_maps=per_game_topic_alias_maps,
        max_topics=max_selected_topics,
        max_keywords=max_expanded_keywords,
    )
