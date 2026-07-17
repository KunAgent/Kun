# HKEX 招股书检索策略库

本文档列出从 Google / Bing / HKEX 披露易检索 HK IPO 招股书的所有查询模板和实战策略。

---

## 一、披露易官方检索

### 1.1 高级搜索入口

```
https://www1.hkexnews.hk/listedco/listconews/advancedsearch/search_active_main.aspx
```

**关键参数**：
| 参数 | 取值 | 说明 |
|------|------|------|
| Document Type | "Listing Documents" | 上市文件（招股书属此类） |
| Sub-document Type | "Prospectuses" | 招股章程 |
| Date Range | 起止日期 | YYYY-MM-DD |
| Stock Code | 股票代码 | 已上市公司可直接查 |

### 1.2 直接 URL 模板（按公司）

```
# 已上市公司公告页（已知 stock code 时）
https://www.hkexnews.hk/listedco/listconews/sehk/{YYYY}/{MMDD}/{stockcode}_{n}.htm

# 公告 PDF 文件名通用模式
https://www1.hkexnews.hk/listedco/listconews/sehk/{YYYY}/{MMDD}/{filename}.pdf
```

### 1.3 主页索引

```
https://www.hkexnews.hk/index_e.htm   # 英文版
https://www.hkexnews.hk/index_c.htm   # 中文版
```

---

## 二、Google Dorking 检索（推荐）

Google 索引比 HKEX 自家搜索更精准，是**首选检索方式**。

### 2.1 按投行检索

```
# A. 寻找某投行担任独家保荐人
site:hkexnews.hk "Sole Sponsor" "Goldman Sachs"
site:hkexnews.hk "Sole Sponsor" "Morgan Stanley"
site:hkexnews.hk "独家保荐人" "高盛"
site:hkexnews.hk "独家保荐人" "中信证券"

# B. 寻找某投行担任联席保荐人
site:hkexnews.hk "Joint Sponsors" "Goldman Sachs"
site:hkexnews.hk "Joint Sponsors" "China International Capital"

# C. 寻找联席账簿管理人
site:hkexnews.hk "Joint Bookrunners" "Goldman Sachs" 2025

# D. 限定时间段
site:hkexnews.hk "Sole Sponsor" "Goldman Sachs" 2025
site:hkexnews.hk "Sole Sponsor" "Goldman Sachs" "2025"
```

### 2.2 按律所检索

```
# 法律顾问通常在招股书里以这种格式出现
site:hkexnews.hk "as to Hong Kong law" "Linklaters"
site:hkexnews.hk "as to U.S. law" "Sullivan & Cromwell"
site:hkexnews.hk "as to PRC law" "Fangda Partners"
site:hkexnews.hk "Legal Advisers to the Sponsors" "Linklaters"
```

### 2.3 按会计师事务所检索

```
site:hkexnews.hk "Reporting Accountants" "PricewaterhouseCoopers"
site:hkexnews.hk "Auditors" "Deloitte" 2025
site:hkexnews.hk "申报会计师" "普华永道"
```

### 2.4 按行业 / 赛道检索

```
# 生物科技 IPO（含 18A 适用）
site:hkexnews.hk "Chapter 18A" prospectus
site:hkexnews.hk "biotech" "Sole Sponsor" 2025

# AI / 科技 IPO
site:hkexnews.hk "artificial intelligence" prospectus 2025
site:hkexnews.hk "AI infrastructure" listing document 2025

# 消费 / 新茶饮
site:hkexnews.hk "consumer" "Sole Sponsor" 2025

# 医疗器械
site:hkexnews.hk "medical device" "Joint Sponsors" 2025
```

### 2.5 按发行类型

```
# A+H 双重上市
site:hkexnews.hk "A+H" listing document 2025
site:hkexnews.hk "A股+港股" 招股章程 2025

# Specialist Technology (18C)
site:hkexnews.hk "Chapter 18C" prospectus

# 中概股回港 secondary listing
site:hkexnews.hk "Secondary Listing" "Sole Sponsor" 2024..2025

# SPAC
site:hkexnews.hk "SPAC" "promoter"
```

### 2.6 PDF 直接定向检索

```
# 直接搜 PDF 类型
filetype:pdf site:hkexnews.hk "Sole Sponsor" "Goldman Sachs" 2025

# 招股书章节专项
filetype:pdf site:hkexnews.hk "DIRECTORS AND PARTIES INVOLVED IN THE LISTING"
filetype:pdf site:hkexnews.hk "WAIVERS FROM STRICT COMPLIANCE"
```

---

## 三、备选数据源（HKEX 直接搜索失败时降级）

### 3.1 IPO 新闻聚合

```
# 中文 IPO 新闻（瑞恩资本是港股 IPO 的核心信源）
site:ipoxie.com "牧原" 保荐人
site:ruiyancapital.com 保荐人 高盛 2025

# 英文 IPO 新闻
"Goldman Sachs" "Sole Sponsor" Hong Kong IPO 2025
site:reuters.com "Sole Sponsor" Hong Kong IPO 2025
site:bloomberg.com "Sole Sponsor" Hong Kong IPO 2025

# 行业聚合站
site:dealogic.com "Sole Sponsor" Hong Kong 2025
site:ipoglobal.hk 2025
```

### 3.2 港交所市场数据

```
# 港交所季度 IPO 报告
"HKEX Quarterly IPO Statistics" 2025

# 香港 IPO 排行榜
"Hong Kong IPO league table" 2025
"港股 IPO 保荐人排行" 2025
```

### 3.3 中文媒体（往往会在新闻里直接列出保荐人）

```
"牧原食品 港股 IPO 保荐人"
"阶跃星辰 IPO 中介团队"
site:21jingji.com 保荐人 香港 2025
site:cls.cn 保荐人 香港 2025
```

---

## 四、查询变体生成策略

针对每个检索目标（如"高盛 2025 HK IPO 保荐人"），自动生成 **6-10 个变体**：

```python
def generate_queries(target_firm, year=None, role=None):
    aliases = COMPANY_ALIASES[target_firm]  # 见 company-aliases
    queries = []

    # 基础组合
    for alias in aliases[:3]:  # 取最常见 3 个别名
        if role:
            queries.append(f'site:hkexnews.hk "{role}" "{alias}"')
        else:
            for r in ['Sole Sponsor', 'Joint Sponsors', 'Joint Bookrunners']:
                queries.append(f'site:hkexnews.hk "{r}" "{alias}"')

    # 加时间过滤
    if year:
        queries = [f'{q} {year}' for q in queries]

    # 中文版
    if target_firm in CHINESE_FIRMS:
        queries.append(f'site:hkexnews.hk "保荐人" "{aliases[0]}"')

    # 备用 Google 搜索（不限 site）
    queries.append(f'"{aliases[0]}" "Sole Sponsor" Hong Kong IPO {year or ""}')

    return queries[:10]
```

---

## 五、实战经验（基于过往挖掘）

### 5.1 港股 IPO 季节性

| 时段 | 特点 | 检索建议 |
|-----|------|---------|
| Q1（1-3月） | 上一年报告期 + 春节前后 IPO 高峰 | 搜 12月-1月递表 |
| Q2（4-6月） | 上半年 IPO 主期 | 重点期 |
| Q3（7-9月） | 暑期相对淡 | 跳过 |
| Q4（10-12月） | 抢年内上市窗口 | 重点期 |

### 5.2 高频出现的中介机构

**外资投行**：
- Goldman Sachs / Morgan Stanley / JPMorgan / UBS / BofA / Citi / HSBC

**中资投行**（对中国发行人 IPO 项目最活跃）：
- 中信证券 (CITIC Securities) / 中金 (CICC) / 华泰国际 / 海通国际 / 招商证券 / 国泰海通

**律所**（HK Law）：
- Linklaters / Davis Polk / Freshfields / Norton Rose / Skadden / Sullivan & Cromwell / Clifford Chance / Slaughter & May

**律所**（PRC Law）：
- 方达律师事务所 / 君合 / 通商 / 中伦 / 金杜 / 海问

**会计师**（Big 4）：
- PwC / Deloitte / KPMG / EY

### 5.3 容易踩的坑

⚠️ **保荐人 vs 整体协调人 vs 联席账簿管理人**：
- 港股 IPO 改革后（2024.8 起）"整体协调人" (OC) 是新角色
- 整体协调人是有保荐人意义的 underwriter，但严格来说不等同 Sponsor
- 检索时**两者都要扫**

⚠️ **保荐代表人 vs 保荐机构**：
- 招股书会明确写"保荐代表人姓名"（中文版）/ "Sponsor Principals"（英文版）
- 不是所有招股书都列出姓名（部分项目仅列机构）

⚠️ **A+H 双重上市**：
- A 股招股书在中国证监会，H 股在 HKEX
- 同一项目可能 A 股保荐人 ≠ H 股保荐人（很常见）

⚠️ **PDF 长度**：
- 标准招股书 200-500 页
- 不要全文 fetch，只抽取目录定位的关键章节
- 如果 web_fetch 失败 → 改 fetch 该公司"上市文件章节摘要"页

---

## 六、推荐检索顺序（实战）

```
Step 1: site:hkexnews.hk "{role}" "{firm_alias}" {year}
        → 拿 PDF 直接 URL

Step 2: 如果 Step 1 结果 < 5 个 → 降级
        site:reuters.com / site:bloomberg.com / site:ipoxie.com
        → 拿 deal 名 + 推断 prospectus 路径

Step 3: 解析 PDF（web_fetch + LLM）

Step 4: 失败的 PDF → 加入 open_questions，不阻塞流程
```
