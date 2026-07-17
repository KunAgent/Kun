#!/usr/bin/env python3
"""
schema_linker.py — 字段相关性过滤，减少注入 AI Prompt 的 Schema 噪声。

给定用户问题和若干字段列表，返回最相关的字段子集，降低 token 消耗并提升生成质量。

当前实现：method="keyword"（关键词匹配）
预留接口：method="embedding"（向量相似度，尚未实现）

Usage (standalone):
    python schema_linker.py --question "日活跃用户趋势" \
        --columns "date,dau,mau,revenue,units_sold" \
        --method keyword
"""

from __future__ import annotations

import argparse
import re
import sys
from typing import Optional

# ── 停用词（中英文，不参与关键词匹配） ────────────────────────────────────
_STOPWORDS = {
    "的", "了", "和", "与", "或", "在", "是", "有", "我", "你", "他", "她",
    "我们", "这", "那", "什么", "如何", "怎么", "哪些", "最近", "一下",
    "the", "a", "an", "of", "in", "on", "at", "for", "to", "by", "is",
    "are", "was", "were", "be", "been", "have", "has", "had", "do", "does",
    "did", "and", "or", "not", "with", "from", "that", "this",
}

# ── 业务语义扩展词典（问题词 → 可能相关的字段关键词） ─────────────────────
_SEMANTIC_EXPANSIONS: dict[str, list[str]] = {
    "日活": ["dau", "active_users", "daily"],
    "月活": ["mau", "monthly"],
    "周活": ["wau", "weekly"],
    "留存": ["retention", "bounded", "unbounded", "return"],
    "收入": ["revenue", "income", "gmv"],
    "下载": ["download", "install"],
    "销量": ["units_sold", "sales", "units"],
    "评分": ["rating", "score", "review"],
    "评论": ["review", "comment", "content", "sentiment"],
    "情绪": ["sentiment", "isvalid", "sentiment_rating"],
    "渠道": ["channel", "platform", "source"],
    "国家": ["country", "market", "region"],
    "平台": ["platform", "device", "storefront"],
    "时间": ["date", "time", "comment_time", "month", "week"],
    "游戏": ["game_id", "unified_edition_id", "app_id", "edition_id", "combined_id"],
    "主播": ["streamer", "broadcaster"],
    "直播": ["stream", "hours_watched", "viewers", "platform"],
    "关注": ["follower", "wishlist", "follow"],
    "愿望单": ["wishlist", "wishlists"],
    "排行": ["rank", "ranking", "top"],
    "同时在线": ["acu", "pcu", "concurrent"],
    "价格": ["price", "cost"],
    "累计": ["total", "cumulative"],
}


def _tokenize(text: str) -> list[str]:
    """简单分词：按空白 + 标点切分，去除停用词和单字母。"""
    tokens = re.split(r"[\s\W]+", text.lower())
    return [t for t in tokens if t and t not in _STOPWORDS and len(t) > 1]


def _expand_keywords(tokens: list[str]) -> set[str]:
    """通过语义词典扩展关键词集合。"""
    expanded = set(tokens)
    for token in tokens:
        for trigger, expansions in _SEMANTIC_EXPANSIONS.items():
            if trigger in token or token in trigger:
                expanded.update(expansions)
    return expanded


def _score_column_keyword(col_name: str, col_display: str, keywords: set[str]) -> float:
    """对单个字段计算关键词匹配得分（0.0 ~ N）。"""
    col_lower = col_name.lower()
    display_lower = (col_display or "").lower()
    score = 0.0
    for kw in keywords:
        if kw in col_lower:
            score += 1.0
        elif kw in display_lower:
            score += 0.5
        # 部分匹配：字段名是关键词子串
        elif col_lower in kw and len(col_lower) > 2:
            score += 0.3
    return score


def link_by_keyword(
    question: str,
    columns: list[dict],
    top_k: int = 20,
    always_include: Optional[list[str]] = None,
) -> list[dict]:
    """
    关键词匹配字段选择。

    Args:
        question: 用户自然语言问题
        columns: 字段列表，每项包含 name / display_name / origin_type / role 等字段
        top_k: 最多返回字段数
        always_include: 强制保留的字段名列表（如主键、分区字段）

    Returns:
        过滤后的字段列表（按得分降序）
    """
    tokens = _tokenize(question)
    keywords = _expand_keywords(tokens)

    always_set = set(always_include or [])
    scored = []
    forced = []

    for col in columns:
        col_name = col.get("name", "")
        if col_name in always_set:
            forced.append((col, 999.0))
            continue
        display = col.get("display_name") or col.get("display_name_en") or ""
        score = _score_column_keyword(col_name, display, keywords)
        scored.append((col, score))

    # 按得分排序，截取 top_k（强制字段不占 top_k 名额）
    scored.sort(key=lambda x: x[1], reverse=True)
    selected = [col for col, _ in scored[:top_k]]

    # 合并强制字段（去重）
    forced_cols = [col for col, _ in forced]
    existing_names = {c.get("name") for c in selected}
    for col in forced_cols:
        if col.get("name") not in existing_names:
            selected.insert(0, col)

    return selected


def link_by_embedding(
    question: str,
    columns: list[dict],
    top_k: int = 20,
    always_include: Optional[list[str]] = None,
    **kwargs,
) -> list[dict]:
    """
    向量相似度字段选择（预留接口，尚未实现）。

    未来实现思路：
    1. 使用 embedding 模型将 question 和每个字段（name + display_name + description）编码为向量
    2. 计算 cosine 相似度，取 top_k
    3. 合并 always_include 强制字段

    Args:
        question: 用户自然语言问题
        columns: 字段列表
        top_k: 最多返回字段数
        always_include: 强制保留的字段名列表
        **kwargs: 预留参数（如 model_name, embedding_fn 等）

    Raises:
        NotImplementedError: 此方法尚未实现，请使用 method='keyword'
    """
    raise NotImplementedError(
        "embedding 方法尚未实现。\n"
        "请使用 method='keyword'，或在此处接入向量模型（如 text-embedding-ada-002 / BGE / m3e）。\n"
        "实现提示：将 question 和每个字段的 name+display_name+description 编码后计算 cosine 相似度。"
    )


def select_columns(
    question: str,
    columns: list[dict],
    method: str = "keyword",
    top_k: int = 20,
    always_include: Optional[list[str]] = None,
) -> list[dict]:
    """
    统一入口：根据 method 选择字段过滤策略。

    Args:
        question: 用户自然语言问题
        columns: 字段列表（来自 fetch_schema 的 column_list）
        method: 'keyword'（关键词匹配）或 'embedding'（向量相似度，未实现）
        top_k: 最多返回字段数
        always_include: 强制保留的字段名列表

    Returns:
        过滤后的字段列表
    """
    if method == "keyword":
        return link_by_keyword(question, columns, top_k=top_k, always_include=always_include)
    elif method == "embedding":
        return link_by_embedding(question, columns, top_k=top_k, always_include=always_include)
    else:
        raise ValueError(f"未知 method: {method!r}，支持 'keyword' 或 'embedding'")


# ── CLI 入口（调试用） ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="字段相关性过滤（调试用）")
    parser.add_argument("--question", required=True, help="用户问题")
    parser.add_argument("--columns", required=True, help="字段名列表，逗号分隔")
    parser.add_argument("--method", choices=["keyword", "embedding"], default="keyword")
    parser.add_argument("--top_k", type=int, default=20, help="最多返回字段数")
    parser.add_argument("--always_include", default=None, help="强制保留字段，逗号分隔")
    args = parser.parse_args()

    col_names = [c.strip() for c in args.columns.split(",")]
    columns = [{"name": n} for n in col_names]
    always = [c.strip() for c in args.always_include.split(",")] if args.always_include else None

    try:
        result = select_columns(args.question, columns, method=args.method,
                                top_k=args.top_k, always_include=always)
    except NotImplementedError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"问题: {args.question}")
    print(f"方法: {args.method} | top_k={args.top_k}")
    print(f"保留字段 ({len(result)}):")
    for col in result:
        print(f"  {col['name']}")


if __name__ == "__main__":
    main()
