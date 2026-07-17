## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# SEC Filing Miner — 工作流编排详解

5 阶段工作流的精确工具调用方式 + LLM Prompt。

## Stage 1: 意图解析

```python
INTENT_PROMPT = """
分析用户请求，提取结构化字段：
{user_query}

输出 JSON:
{
  "target_type": "investment_bank | law_firm | accounting_firm | issuer | industry",
  "target_company": "...",
  "target_aliases": [...],
  "issuer_geography": "China / US / All",
  "form_types": ["F-1", "F-1/A", "424B4"],
  "time_range_start": "YYYY-MM-DD",
  "time_range_end": "YYYY-MM-DD",
  "max_filings": 20
}
"""
```

## Stage 2: SEC EDGAR 检索

### 主路径: EDGAR 全文搜索 API

```python
BASE = "https://efts.sec.gov/LATEST/search-index"
queries = []
for alias in intent["target_aliases"][:3]:
    for role_phrase in ['"underwriters"', '"Lead Bookrunner"', '"Joint Bookrunner"']:
        queries.append(f'"{alias}" {role_phrase}')

for q in queries[:6]:
    url = f"{BASE}?q={urlencode(q)}&forms={','.join(intent['form_types'])}"
    if intent.get('time_range_start'):
        url += f"&dateRange=custom&startdt={intent['time_range_start']}&enddt={intent['time_range_end']}"
    resp = web_fetch(url, fetchInfo="提取 hits 数组中所有 filing 的 accession_number, cik, form, filing_date, display_names")
```

### 降级: Google Dorking

```python
if not edgar_results:
    web_search(query=f'site:sec.gov inurl:Archives "{alias}" "underwriters"')
```

## Stage 3: HTML/PDF 抽取

### HTML 抽取（首选 90%）

```python
sections = web_fetch(filing["primary_doc_url"], fetchInfo="""
提取章节: UNDERWRITING / PLAN OF DISTRIBUTION / EXPERTS / LEGAL MATTERS / MANAGEMENT / Cover Page
每章节单独标记，原文返回""")
```

### PDF 抽取（备选 5%，复用 hkex 脚本）

```python
if filing["primary_doc_url"].endswith(".pdf"):
    subprocess.run([
        "python3", f"{HKEX_SKILL_BASE}/scripts/fetch_and_extract_pdf.py",
        "--url", filing["primary_doc_url"],
        "--output", "/tmp/sec_temp",
        "--sections", "UNDERWRITING,PLAN OF DISTRIBUTION,EXPERTS,LEGAL MATTERS",
    ], timeout=120)
```

### 抓取关键 Exhibit（律所合伙人签字 / 审计师同意函）

```python
index = web_fetch(filing["filing_index_url"], fetchInfo="提取所有 EX-1.1, EX-5.1, EX-8.1, EX-23.1 URL")
for ex_type in ["EX-5.1", "EX-23.1"]:
    if ex_type in exhibits_urls:
        content = web_fetch(exhibits_urls[ex_type],
            fetchInfo=f"提取 {ex_type} 全部正文，特别关注合伙人/审计师签字部分")
```

### 错误处理

| 错误 | 处理 |
|------|------|
| EDGAR 403 | 检查 User-Agent: "Lymc Bot (email@example.com)" |
| EDGAR 429 | 指数退避 5/15/45 秒 |
| HTML > 10MB | 只抓 Cover + UNDERWRITING + EXPERTS |
| LLM 解析空 | 重试 1 次 |

## Stage 4: 团队解析与去重

```python
firms_data = {}
for ext in all_extracted:
    deal_record = {
        "deal": ext["issuer"]["name_en"],
        "deal_type": "US IPO",
        "exchange": ext["issuer"]["exchange"],
        "ticker": ext["issuer"]["ticker"],
        "filing_url": ext["filing_url"],
        "source": "sec-filing-miner v1.0"
    }

    # 承销团
    for u in ext["underwriters"]:
        fid = normalize_firm_id(u["firm_name"])
        firms_data.setdefault(fid, {"deals": [], "personnel": []})
        firms_data[fid]["deals"].append({**deal_record, "ms_role": u["role"], "is_lead": u.get("is_lead")})

    # 律所
    for c in ext["legal_counsel_to_company"]:
        fid = normalize_firm_id(c["firm_name"])
        firms_data.setdefault(fid, {"deals": [], "personnel": []})
        firms_data[fid]["deals"].append({**deal_record, "ms_role": f"Issuer Counsel ({c['scope']})"})

    # 签字律所合伙人（high value）
    if ext.get("legal_signatures"):
        sig = ext["legal_signatures"]
        fid = normalize_firm_id(sig["law_firm"])
        firms_data[fid]["personnel"].append({
            "name": sig["signatory_name"],
            "title": sig["signatory_title"],
            "deal": deal_record,
            "source": f"SEC EX-5.1 - {ext['filing_url']}",
            "confidence": "very_high"
        })
```

## Stage 5: 入库 + 渲染

### 跨 Skill 合并到同一 JSON

```python
def merge_with_existing(firm_id, new_data):
    path = f"iWiki 用户目录/01-公司组织库/{firm_id}.json"
    if not exists(path):
        return create_new_firm(firm_id, new_data)
    kb = json.load(open(path))

    # 1. 合并 deals (去重 by ticker + market)
    existing_keys = {(d.get("ticker"), d.get("deal_type"))
                     for d in kb.get("confirmed_deals_and_rankings", [])
                     if d.get("ticker")}
    for new_deal in new_data["deals"]:
        key = (new_deal.get("ticker"), new_deal.get("deal_type"))
        if key not in existing_keys:
            kb["confirmed_deals_and_rankings"].append(new_deal)

    # 2. 合并 personnel (按 name 匹配，同名合并 deal_history)
    for new_p in new_data["personnel"]:
        matched = None
        for existing_p in kb["personnel"]:
            if name_match(existing_p["name"], new_p["name"]):
                matched = existing_p
                break
        if matched:
            matched.setdefault("deal_history", []).append({
                "deal": new_p["deal"]["deal"],
                "role": new_p["deal"]["ms_role"],
                "market": "US",
                "date": new_p["deal"]["filing_date"],
                "source": "sec"
            })
            matched["confidence"] = "very_high"
            mc = matched.setdefault("market_coverage", [])
            if "US" not in mc: mc.append("US")
        else:
            kb["personnel"].append({
                **new_p,
                "deal_history": [{"deal": new_p["deal"]["deal"], "market": "US", "source": "sec"}],
                "market_coverage": ["US"],
                "confidence": "very_high"
            })

    # 3. update_history
    kb["update_history"].append({
        "timestamp": now_iso(),
        "source": "sec-filing-miner v1.0",
        "changes": f"扫描 {n_filings} 份 SEC filings → 新增 {n_new_deals} deals / 验证 {n_verified} 人员 / 升级 {n_upgraded} confidence"
    })

    json.dump(kb, open(path, "w"), ensure_ascii=False, indent=2)
```

### 触发 HTML 重渲染

```python
for firm_id in updated_firms:
    regenerate_html_with_market_badge(firm_id)
```

### 输出报告

```markdown
## SEC Filing 挖掘结果（与 HKEX 数据合并）

**目标**: {target_company} {time_range}
**检索 filings**: {total_found}
**解析成功**: {parsed_success} / {parsed_failed} 失败
**新增/更新**: {new_deals} deals / {new_personnel} 新增人员 / {upgraded_confidence} 人升级 confidence

**关键发现**:
- {firm_name} 在 {time_range} 担任 {n_lead} 个 Lead Bookrunner + {n_co} 个 Co-Manager
- 跨市场覆盖: {n_dual_market_persons} 位同时参与 HK + US IPO
- 新发现律所合伙人: {top_lawyers}（{filing_count} 个 EX-5.1 签字）

**已生成/更新**:
- {firm_id}.json (新增 {n} deals + 升级 {m} 人员 confidence)
- {new_law_firm}.json (新建)
- HTML 架构图 {n_charts} 张已重生成

**Open Questions**:
- {failed_pdf_list}
- {unrecognized_firms_list}
```

## 性能预算

- 单次完整执行: 4-6 分钟（15 份 filings）
- web_search: 6-8 次
- web_fetch: 30-50 次（每 filing 主文件 + 2-4 个 Exhibit）
- LLM 解析: 20-40 次
- token 消耗: 80k-150k

## 错误降级总结

| 场景 | 降级路径 |
|------|---------|
| EDGAR 全站不可用 | 改 Google Dorking site:sec.gov |
| 单 filing 抓取失败 | 重试 1 次 → 跳过，写 open_questions |
| Exhibit URL 错误 | 从 filing-index.htm 重新解析 |
| HTML 文件超大 | 只抓关键章节，跳过全文 |
| 整批失败 | 报告"挖掘失败"，提示用户重试或换时间窗 |
