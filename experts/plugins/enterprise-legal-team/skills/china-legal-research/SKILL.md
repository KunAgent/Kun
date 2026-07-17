---
name: china-legal-research
description: 中国法条、案例、法规、企业风险与引用核验检索工具。Use when the legal expert needs current PRC statutes, cases, regulations, company risk data, or hallucination checks. Requires user-provided YD_API_KEY; paid API calls consume credits.
allowed-tools: Read, Bash
---

# 中国法条与案例检索

This skill ports the useful parts of the yuan-dian legal search package into the enterprise legal team. It is the preferred data-backed source for China law questions when the user has configured an API key.

## Use when

- 用户要求查询中国法律条文、法规、司法解释或案例。
- 专家需要核验法条、案例、裁判要旨是否真实存在。
- 企业尽调需要查询涉诉、行政处罚、失信、商标、专利、欠税等公开风险线索。
- 中国本地化分析需要把模型判断落到可追溯来源上。

## What was imported

- `scripts/yd_search.py` and its updater dependency.
- 35 endpoint reference documents under `references/`.
- No historical archive data and no API key were imported.

## API key and cost rule

- API key must come from `YD_API_KEY` environment variable or `scripts/.env`.
- Do not invent results when the key is missing. Explain that a configured key is required.
- Core law/case searches may run directly when the user asks for research.
- High-cost calls such as case detail, enterprise deep dive, and hallucination detection should be confirmed first unless the user already asked for that depth.
- Report API credit consumption after each call.

## Routing

- 法条依据：use `search`, `keyword`, or `detail`.
- 案例检索：use `case` or `case-semantic`; fetch `case-detail` only after relevance is clear or user confirms.
- 企业风险：start with `enterprise-search`, then `enterprise-base` / `enterprise-summary`, then selected `enterprise-list` dimensions.
- 引用核验：use `hall-detect` only when the user asks or when a legal citation will materially affect the conclusion.

## Output style

Return concise research findings with source labels, retrieval time, and what still needs lawyer verification. Keep the result usable for the relevant team member rather than dumping raw API JSON.
