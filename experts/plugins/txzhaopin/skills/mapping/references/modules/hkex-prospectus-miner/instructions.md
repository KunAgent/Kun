---
name: hkex-prospectus-miner
description: "港交所 HKEX 招股书人才挖掘器。从港交所披露易公开招股书 PDF 中挖掘投行保荐代表人、承销团队、律所合伙人、审计师、董事高管等法定披露人员信息。这是法定披露的最高质量人员挖掘渠道——所有姓名必须公开。适用于挖掘 HK IPO 投行 / 律所 / 会计师事务所合伙人 / 中资券商保代。触发短语：港交所 IPO、HKEX prospectus、保荐代表人、sponsor principal、扒招股书、挖 IPO 团队、hkex-prospectus-miner、查 HK IPO 团队、招股书人员。"
---

# HKEX Prospectus Miner v1.0

港交所招股书 → 投行/律所/会计师团队挖掘 Skill。

**核心定位**：从港交所披露易（HKEXnews）公开的招股书 PDF / 上市文件中挖掘**法定披露**的中介机构团队人员，**这是法定披露**——所有姓名必须公开，因此是最高质量的人员挖掘渠道。

---

## 一、适用场景

✅ **适合用此 Skill**：
- 挖某投行在某段时期的 HK IPO 保荐代表人名单
- 交叉验证某 banker 是否实际承担保荐职务
- 挖某律所 / 会计师事务所在 HK IPO 项目的合伙人/经办人
- 挖某赛道（科技/医疗/消费）所有 HK IPO 的中介团队
- 服务投资业务线的 Mapping 工作

❌ **不适合用此 Skill**：
- 挖未上市公司团队（→ `linkedin-deep-miner`）
- 挖美股 IPO 团队（→ `sec-filing-miner`）
- 挖游戏美术（→ `artstation-talent-finder`）
- 挖一级市场 deal team（→ `deal-news-miner`）

---

## 二、关键数据源

| 数据源 | URL | 说明 |
|-------|-----|------|
| **披露易（HKEXnews）** | `https://www.hkexnews.hk/` | 港交所官方披露平台，所有 IPO 招股书的权威来源 |
| **披露易高级搜索** | `https://www1.hkexnews.hk/listedco/listconews/advancedsearch/search_active_main.aspx` | 按公司/日期/文件类型搜索 |
| **公告分类** | "Listing Documents" / "招股章程" | IPO 招股书统一分类 |
| **Google 索引** | `site:hkexnews.hk filetype:pdf "Sole Sponsor"` | 备选检索方式（Google 索引常更精准） |

---

## 三、5 阶段工作流

### Stage 1: 意图解析

从用户请求中提取：

```json
{
  "target_type": "investment_bank | law_firm | accounting_firm | issuer",
  "target_company": "Goldman Sachs / 中信证券 / 高盛 / Linklaters",
  "target_aliases": ["GS", "Goldman", "高盛"],
  "industry_filter": "Tech | Healthcare | Consumer | Financial | All",
  "time_range": "2024-2026 | last 12 months",
  "ipo_status": "completed | in_progress | all",
  "role_filter": "Sponsor | Joint Bookrunner | Lead Manager | Underwriter | Legal Counsel | Auditor"
}
```

**示例输入解析**：
- "扒高盛 2025 年 HK IPO 保荐人" → target=GS / time=2025 / role=Sponsor
- "Linklaters 在 HK IPO 的合伙人" → target=Linklaters / role=Legal Counsel
- "近 12 个月所有医疗类 IPO 团队" → industry=Healthcare / time=last 12 months

### Stage 2: 招股书检索

**主路径**（推荐）：

```
工具：web_search
查询模板（生成 6-10 个变体）：
─────────────────────────────────────────
A. 公司+赛道+时间：
   site:hkexnews.hk "Sole Sponsor" "Goldman Sachs" 2025
   site:hkexnews.hk "Joint Sponsor" "高盛" 2024..2025

B. 投行交叉：
   "Goldman Sachs" prospectus HKEX 2025 sponsor
   "高盛" 招股章程 香港上市 2025 保荐人

C. 赛道筛查：
   site:hkexnews.hk "biotech" prospectus 2025
   site:hkexnews.hk "AI" prospectus 2025

D. 直接 HKEXnews：
   "Listing Documents" HKEXnews "Sole Sponsor"
─────────────────────────────────────────
```

**降级路径**（HKEX 网站访问失败时）：
- 改查 IPO 新闻：`"high-profile IPO" "Goldman Sachs" Hong Kong 2025`
- 改查中文媒体：腾讯新闻/瑞恩资本/财联社（往往会列保荐人名单）

**输出**：候选招股书清单
```json
[
  {
    "issuer_name_zh": "牧原食品",
    "issuer_name_en": "Muyuan Foods",
    "industry": "Consumer/Agriculture",
    "ipo_date": "2025-06",
    "prospectus_url": "https://www1.hkexnews.hk/.../sehk_yxxx.pdf",
    "found_via": "Google site search"
  }
]
```

### Stage 3: PDF 抽取

**工具**：`scripts/fetch_and_extract_pdf.py`（v1.1 新增本地 PDF 解析能力）+ LLM 解析

**v1.0 vs v1.1 关键差异**：

| 版本 | PDF 解析方式 | 限制 |
|-----|------------|------|
| v1.0 | 直接 `web_fetch` PDF URL | ❌ web_fetch 拿到的是 FlateDecode 压缩流，看不到正文 |
| **v1.1** | **本地下载 PDF + pdfplumber 解析章节** | ✅ 完整正文可读，章节可定位 |

**3.1 PDF 下载与章节抽取**

```bash
# 自动下载 + 抽取 6 个核心章节
python3 {SKILL_BASE_DIR}/scripts/fetch_and_extract_pdf.py \
  --url "https://www1.hkexnews.hk/listedco/.../prospectus.pdf" \
  --output ./hkex_temp \
  --max-pages-per-section 8

# 输出：
# - hkex_temp/{filename}.pdf            （原 PDF 缓存）
# - hkex_temp/{filename}_sections.json  （抽取的章节文本）
# - hkex_temp/{filename}_intermediaries.json （正则兜底识别）
```

**3.2 抽取的关键章节**（自动扫描 PDF 定位）

| 章节 | 提取价值 | 通常位置 |
|------|---------|---------|
| `DIRECTORS, SUPERVISORS AND PARTIES INVOLVED IN THE GLOBAL OFFERING` | ⭐⭐⭐⭐ 中介机构完整列表 | 第 100-130 页 |
| `UNDERWRITING` | ⭐⭐⭐ 全体承销团 | 第 200-300 页 |
| `Consents of Experts`（附录 VI） | ⭐⭐⭐⭐⭐ **签字人/合伙人姓名** | 倒数 30-50 页 |
| `STATUTORY AND GENERAL INFORMATION` | ⭐⭐⭐⭐ 法定附录 | 倒数 50-100 页 |
| `CORPORATE INFORMATION` | ⭐⭐ 注册地、办公地 | 第 100-115 页 |

**3.3 LLM 精细化解析**

抽取的章节 JSON 交给 LLM 做最终结构化（Prompt 见 `references/intermediary-extraction.md`）。本地 pdfplumber 已经把 600 页 PDF 缩小到 ~50KB 的精准章节文本，LLM 解析非常高效。

**3.4 实测验证（CATL 宁德时代招股书）**

- 输入：`https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0512/2025051200005.pdf`
- PDF 大小：6.1 MB，626 页
- 自动定位章节：4/4 命中（CORPORATE INFO / STATUTORY / UNDERWRITING / Consents of Experts）
- 解析时间：~30 秒
- 关键发现（从 Consents of Experts P621 章节）：
  - 联席保荐人 4 家：中金 / 中信建投国际 / JPMorgan / Merrill Lynch
  - 律师：Llinks Law Offices（通力）
  - ……

**3.5 安装依赖**

```bash
pip install pdfplumber  # 唯一依赖
```

如果 pdfplumber 未安装，脚本会优雅降级（提示用户安装）。

**3.6 错误处理**

| 错误 | 处理 |
|------|------|
| PDF 下载失败（网络/超时） | 重试 1 次，仍失败则跳过 |
| PDF 是图片格式（OCR 需求） | pdfplumber 抽不到文字 → 标注 `extraction_failed: image_pdf` |
| 章节标题未找到 | 兜底返回前 50 页文本 |
| PDF 损坏 | 跳过，写入 `open_questions` |

### Stage 4: 团队解析与去重

**多招股书合并规则**：
- 同一 banker 在 N 个项目出现 → 计入项目经验，置信度 +N
- 不同名但同 firm + 同期 → 视为同事关系
- 提取签字合伙人：律师/会计师的"专业人士同意书"会披露

**关键人员标注**：
```
Sponsor Principal（保荐代表人）   ⭐⭐⭐ 最高价值，必有姓名披露
Engagement Partner（经办合伙人） ⭐⭐⭐ 律师/会计师场景
Joint Bookrunner Lead            ⭐⭐  通常只显机构
Underwriter                       ⭐    机构层面
Director / 高管                   ⭐⭐  招股书董事章节
```

### Stage 5: 入库 + 渲染

**与 `org-knowledge-base` 数据契约**：详见 `references/output-contract.md`

**关键设计**：
- **公司维度按"中介机构"组织**（如 `gs-ibd.json` 已有 → 直接合并新发现）
- **新增字段**：`confirmed_deals_and_rankings`（每个 deal 一行，记录该机构的角色）
- **人员维度**：保荐代表人 + 律所合伙人 + 会计师 partner

**输出报告**：
```markdown
## HKEX 招股书挖掘结果

**目标**: 高盛 2025 年 HK IPO 团队
**检索招股书**: 12 份
**解析成功**: 9 份
**新增/更新人员**: 5 人 / 3 人

**关键发现**:
- 高盛在 2025 年保荐了 6 个项目，涉及 2 位保荐代表人（Andy Tai / Curtis Leung）
- Linklaters 担任高盛香港法律顾问 → 合伙人 John Smith 在 4 个项目签字
- ......

**已生成**: gs-ibd.json + linklaters.json + 各自 HTML 架构图
```

---

## 四、合规与边界

✅ **完全合规**：
- HKEX 披露易是**法定信息披露平台**
- 所有招股书数据均为**强制公开**
- 中介团队姓名是**法律要求披露的事项**

✅ **无反爬风险**：
- HKEXnews 没有反爬限制（公开数据）
- PDF 可以直接 web_fetch 下载

⚠️ **注意事项**：
- 招股书 PDF 通常较大（200-500 页），建议**抽取关键章节**而非全文
- 部分老 IPO（2010 年前）的 PDF 是图片格式，需 OCR（暂不支持，归到 open_questions）

---

## 五、与其他 Skill 的协作

```
[hkex-prospectus-miner 挖到] David Hoyer 是 5 个 HK IPO 的保荐代表人
        ↓ 写入 gs-ibd.json + 标记 confidence=very_high（法定披露）
        ↓
[linkedin-deep-miner 挖到] David Hoyer 现在是 GS HK TMT ED
        ↓ 数据合并到同一 person_id（按姓名匹配）
        ↓
[org-knowledge-base 渲染] David Hoyer 的完整画像：
  - 当前职级：ED
  - 历史项目：5 个 HK IPO（牧原 / 阶跃 / ...）
  - 验证强度：⭐⭐⭐⭐⭐
```

---

## 六、执行参考

详细执行流程参见 `scripts/workflow-orchestration.md`，包括：
- 每阶段调用工具的精确参数
- LLM 解析提示词
- 错误处理策略
- 输出契约样例

中介机构识别表参见 `references/intermediary-extraction.md`。
检索策略详细模板参见 `references/hkex-search-strategies.md`。
