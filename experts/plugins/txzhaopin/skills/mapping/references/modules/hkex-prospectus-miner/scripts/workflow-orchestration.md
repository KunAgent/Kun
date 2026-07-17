## iWiki 公共知识库规则

本模块涉及的归档、查重、读取、更新一律遵循 `references/iwiki-storage-protocol.md`：按 `getCurrentUser` 获取 `{user_key}`，只处理 `用户-{user_key}` 目录树下的页面；其他用户页面只读参考，不得更新。Mapping 结束后必须拆解实体并分别写入 `01-公司组织库`、`02-候选人档案`、`03-项目经历库`、必要时 `04-面评归档`、以及 `05-Mapping报告`；不得只生成报告页。

# HKEX Prospectus Miner — 工作流编排详解

本文档给出 5 阶段工作流每一步的**精确工具调用方式**和 LLM 提示词。

---

## Stage 1: 意图解析

**触发**：用户提到 "扒招股书 / 港交所 IPO / 保荐代表人 / hkex-prospectus-miner"

**LLM 解析**（无外部工具，直接基于用户输入）：

```python
INTENT_PROMPT = """
分析用户请求，提取以下结构化字段：

【用户输入】
{user_query}

【输出 JSON】
{
  "target_type": "investment_bank | law_firm | accounting_firm | issuer | industry",
  "target_company": "...",
  "target_aliases": [...],   // 从 hkex-search-strategies.md 别名表查
  "industry_filter": "Tech / Healthcare / Consumer / Financial / All",
  "time_range_start": "YYYY-MM",
  "time_range_end": "YYYY-MM",
  "ipo_status": "completed | in_progress | all",
  "role_filter": "Sponsor / Joint Bookrunner / Lead Manager / Underwriter / Legal Counsel / Auditor / All",
  "max_deals": 20  // 最多处理多少个 IPO 项目
}

【示例】
输入："扒高盛 2025 年 HK IPO 保荐人"
输出：{
  "target_type": "investment_bank",
  "target_company": "Goldman Sachs",
  "target_aliases": ["Goldman Sachs", "Goldman", "高盛", "GS"],
  "time_range_start": "2025-01",
  "time_range_end": "2025-12",
  "role_filter": "Sponsor",
  "max_deals": 20
}
"""
```

**输出**：意图 JSON 对象（用于驱动后续阶段）

---

## Stage 2: 招股书检索

### 2.1 生成查询变体

加载 `references/hkex-search-strategies.md`，根据意图自动生成 6-10 个 query：

```python
def build_queries(intent):
    aliases = intent["target_aliases"][:3]
    year = intent["time_range_start"][:4]
    queries = []

    if intent["target_type"] == "investment_bank":
        roles = ["Sole Sponsor", "Joint Sponsors", "Joint Bookrunners",
                 "Overall Coordinators"] if intent["role_filter"] == "All" \
                else [intent["role_filter"]]

        for alias in aliases:
            for role in roles:
                queries.append(f'site:hkexnews.hk "{role}" "{alias}" {year}')

        # 加中文版
        if any(c for c in alias if "\u4e00" <= c <= "\u9fff"):
            queries.append(f'site:hkexnews.hk "保荐人" "{aliases[0]}" {year}')

    elif intent["target_type"] == "law_firm":
        for alias in aliases:
            queries.append(f'site:hkexnews.hk "as to Hong Kong law" "{alias}" {year}')
            queries.append(f'site:hkexnews.hk "Legal Advisers" "{alias}" {year}')

    elif intent["target_type"] == "accounting_firm":
        for alias in aliases:
            queries.append(f'site:hkexnews.hk "Reporting Accountants" "{alias}" {year}')

    elif intent["target_type"] == "industry":
        ind = intent["industry_filter"]
        queries.append(f'site:hkexnews.hk "{ind}" prospectus {year}')
        queries.append(f'site:hkexnews.hk "Sole Sponsor" "{ind}" {year}')

    return queries[:10]
```

### 2.2 并行执行查询

**工具调用**：`web_search` × N（并行）

```
for q in queries:
    web_search(query=q, max_results=10)
```

### 2.3 结果聚合

合并所有 web_search 结果，去重（按 URL）：

```python
prospectus_candidates = []
seen_urls = set()
for result in all_search_results:
    url = result["url"]
    if "hkexnews.hk" not in url: continue
    if url in seen_urls: continue
    seen_urls.add(url)
    prospectus_candidates.append({
        "title": result["title"],
        "url": url,
        "snippet": result["snippet"],
        "found_via": query_used
    })
```

### 2.4 输出

候选招股书列表：

```json
[
  {
    "title": "Muyuan Foods - Listing Document",
    "url": "https://www1.hkexnews.hk/listedco/.../sehk_xxxx.pdf",
    "snippet": "...Joint Sponsors... Goldman Sachs ...",
    "ipo_year_inferred": 2025,
    "issuer_name_inferred": "Muyuan Foods"
  },
  ...
]
```

---

## Stage 3: PDF 抽取（v1.1 升级版）

### 3.1 PDF 文件分类

招股书 PDF 通常 200-600 页。**v1.1 改用本地 pdfplumber 解析**，不再依赖 web_fetch。

```python
# v1.0 方式（已废弃）
# result = web_fetch(prospectus_url)  # ❌ 拿到的是 FlateDecode 二进制流

# v1.1 方式（推荐）
# 调用本地脚本下载并抽章节
import subprocess
result = subprocess.run([
    "python3", f"{SKILL_BASE_DIR}/scripts/fetch_and_extract_pdf.py",
    "--url", prospectus_url,
    "--output", "/tmp/hkex_temp",
    "--max-pages-per-section", "8"
], capture_output=True, text=True, timeout=180)

# 然后读取生成的 sections.json
import json
filename = derive_filename(prospectus_url)
sections = json.load(open(f"/tmp/hkex_temp/{filename.replace('.pdf','')}_sections.json"))
```

### 3.2 章节定位策略

`fetch_and_extract_pdf.py` 自动扫描 PDF 全文，找到以下章节起始页：

```python
DEFAULT_SECTIONS = [
    "DIRECTORS AND PARTIES INVOLVED IN THE LISTING",
    "DIRECTORS AND PARTIES INVOLVED IN THE GLOBAL OFFERING",  # CATL 等大型 IPO 用这个
    "UNDERWRITING",
    "STATUTORY AND GENERAL INFORMATION",
    "Consents of Experts",  # 关键：签字人姓名
    "CORPORATE INFORMATION",
]
```

每个章节抽取连续 N 页（默认 8 页），避免过度抓取。

### 3.3 LLM 精细化解析（应用 intermediary-extraction.md 规则）

```python
# 从 sections.json 拿到精准章节文本后，交给 LLM
prospectus_section_text = sections["DIRECTORS AND PARTIES INVOLVED IN THE GLOBAL OFFERING"]["text"]

extracted = llm_parse(EXTRACTION_PROMPT, prospectus_section_text)

# 同样地处理 Consents of Experts（用于签字人姓名）
consents_text = sections.get("Consents of Experts", {}).get("text", "")
if consents_text:
    signatories = llm_parse(SIGNATORY_PROMPT, consents_text)
    extracted["signatories"] = signatories
```

### 3.4 错误处理

| 错误 | 处理 |
|------|------|
| `pdfplumber` 未安装 | 提示用户运行 `pip install pdfplumber`，跳过该 Skill |
| PDF 下载超时（>120s） | 重试 1 次，仍失败 → 跳过 |
| PDF 是图片格式 | pdfplumber 抽不到文字（< 200 字符）→ 标注 `extraction_failed: image_pdf` |
| 章节标题未找到 | 兜底返回前 50 页文本，让 LLM 自行定位 |
| LLM 解析返回空 | 重试一次，仍空则跳过该 PDF |
| 单 PDF 总处理 > 60 秒 | 超时跳过 |

---

## Stage 4: 团队解析与去重

### 4.1 多招股书合并

```python
all_extracted = [extracted1, extracted2, ...]

# 按机构维度聚合
firms = {}  # firm_id -> { "deals": [...], "principals": [...] }

for ext in all_extracted:
    deal_info = {
        "deal": ext["issuer"]["name_en"],
        "deal_zh": ext["issuer"]["name_zh"],
        "stock_code": ext["issuer"].get("stock_code_intended"),
        "industry": ext["issuer"]["industry"],
        "date": ext.get("ipo_date"),
        "prospectus_url": ext["prospectus_url"]
    }

    # 处理 sponsors
    for sp in ext["sponsors"]:
        firm_id = normalize_firm_id(sp["firm_name_en"])
        firms.setdefault(firm_id, {"deals": [], "principals": []})
        firms[firm_id]["deals"].append({**deal_info, "role": sp["role"]})
        for p in sp.get("principals", []):
            firms[firm_id]["principals"].append({**p, "deal": deal_info["deal"]})

    # 处理 lawyers / accountants 同理
    ...
```

### 4.2 人员去重

```python
def merge_principals(firm_principals):
    # 按 (name_en, firm_id) 主键去重
    seen = {}
    for p in firm_principals:
        key = (p["name_en"].lower(), p["firm_id"])
        if key in seen:
            seen[key]["deal_history"].append(p["deal"])
        else:
            seen[key] = {**p, "deal_history": [p["deal"]]}
    return list(seen.values())
```

### 4.3 与已有数据交叉验证

```python
def cross_validate_with_existing(firm_id, new_principals):
    """读取已有 JSON，对比挖到的人是否已存在"""
    existing_path = f"iWiki 用户目录/01-公司组织库/{firm_id}.json"
    if not exists(existing_path): return new_principals

    existing = json.load(open(existing_path))
    for new_p in new_principals:
        for old_p in existing["personnel"]:
            if name_match(new_p["name_en"], old_p["name"]):
                # 升级 confidence
                old_p["confidence"] = "very_high"
                # 追加 deal_history
                old_p.setdefault("deal_history", []).extend(new_p["deal_history"])
                new_p["status"] = "merged"
                break
        else:
            new_p["status"] = "new"
    return new_principals
```

---

## Stage 5: 入库 + 渲染

### 5.1 写入 JSON

按 `output-contract.md` 规则：

```python
def write_to_kb(firm_id, firm_data):
    path = f"iWiki 用户目录/01-公司组织库/{firm_id}.json"

    # 加载/创建
    if exists(path):
        kb = json.load(open(path))
    else:
        kb = build_initial_skeleton(firm_id, firm_data)

    # 1. 追加 confirmed_deals_and_rankings
    for deal in firm_data["deals"]:
        if not any(d["stock_code"] == deal["stock_code"]
                   for d in kb.get("confirmed_deals_and_rankings", [])):
            kb.setdefault("confirmed_deals_and_rankings", []).append(deal)

    # 2. 合并人员
    for p in firm_data["principals"]:
        merge_or_create_personnel(kb, p)

    # 3. 追加 update_history
    kb.setdefault("update_history", []).append({
        "timestamp": now_iso(),
        "source": "hkex-prospectus-miner v1.0",
        "changes": f"扫描 {len(firm_data['deals'])} 份招股书 → 新增 deal {n_new_deals} / 新增人员 {n_new_p} / 验证人员 {n_verified}"
    })

    kb["updated_at"] = now_iso()

    # 写入（atomic）
    json.dump(kb, open(path + ".tmp", "w"), ensure_ascii=False, indent=2)
    os.rename(path + ".tmp", path)
```

### 5.2 触发 HTML 重新渲染

调用 `org-knowledge-base` 的 HTML 生成（伪代码）：

```python
for firm_id in updated_firms:
    regenerate_html(firm_id)  # 复用 org-knowledge-base/scripts/generate-chart.md 模板
```

### 5.3 输出报告（给用户）

```markdown
## HKEX 招股书挖掘结果

**目标**: {target_company} {time_range}
**检索招股书**: {total_found}
**解析成功**: {parsed_success} / {parsed_failed} 失败
**新增/更新人员**: {new_persons} 新增 / {updated_persons} 更新 / {verified_persons} 验证升级 confidence

**关键发现**:
- {firm_name} 在 {time_range} 担任 {n_deals} 个 IPO 的 Sponsor，涉及保荐代表人 {n_principals} 位
- 新发现 deal: {top_3_deals}
- ⭐ 升级 confidence: {top_3_persons}

**已生成文件**:
- {firm_id}.json (更新)
- charts/{firm_id}.html (重生成)
- 关联机构: {related_firms_updated}

**Open Questions**:
- {pdf_extraction_failed_list}
```

---

## 错误处理与降级总结

| 场景 | 降级路径 |
|------|---------|
| HKEX 全站访问失败 | 改 Reuters / Bloomberg / 瑞恩资本 → 拿 deal name 后再试 PDF |
| 单 PDF fetch 失败 | 重试 1 次 → 跳过 → 写 open_questions |
| LLM 解析空 | 重试 1 次 → 跳过 |
| 整批 PDF 都失败 | 报告"挖掘失败 / HKEX 临时不可用"，建议用户重试 |
| 找到 PDF 但全是历史项目（>3 年前） | 提示用户调整时间范围 |

---

## 性能预算

- 单次完整执行：**3-5 分钟**（10-15 份 PDF）
- web_search 调用：**6-10 次**
- web_fetch 调用：**10-30 次**（每 PDF 1-3 次章节抽取）
- LLM 解析：**10-20 次**（每 PDF 1-2 次 prompt）
- token 消耗：约 50k-100k

如果用户的查询范围太大（如"过去 3 年所有外资投行 IPO"），自动拆分为多次执行，每次 max_deals=20。
