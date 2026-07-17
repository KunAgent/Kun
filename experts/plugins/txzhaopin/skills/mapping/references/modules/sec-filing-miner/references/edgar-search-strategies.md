# SEC EDGAR 检索策略库

本文档列出从 SEC EDGAR 检索美股招股书的所有 API 和查询模板。

---

## 一、SEC EDGAR 官方 API

### 1.1 全文搜索 API（推荐 ★）

```
https://efts.sec.gov/LATEST/search-index?q={query}&forms={form_types}&dateRange=custom&startdt=YYYY-MM-DD&enddt=YYYY-MM-DD
```

**参数说明**：
| 参数 | 取值 | 说明 |
|------|------|------|
| q | URL 编码字符串 | 搜索关键词，支持精确短语 `"..."`、操作符 AND/OR |
| forms | F-1, S-1, 424B, 20-F, 10-K, DEF 14A 等 | 多个用逗号分隔 |
| dateRange | custom | 启用自定义日期 |
| startdt / enddt | YYYY-MM-DD | 起止日期 |
| ciks | 0001234567 | 按公司 CIK 过滤 |

**返回**：JSON 格式（含 hits 数组，每条含 filing 元数据 + 文档 URL）

**示例**：
```bash
# 搜索 Goldman Sachs 担任承销商的 F-1 文件 (2024 年)
curl 'https://efts.sec.gov/LATEST/search-index?q=%22Goldman+Sachs%22+%22underwriters%22&forms=F-1&dateRange=custom&startdt=2024-01-01&enddt=2024-12-31' \
  -H "User-Agent: Lymc Mapping Bot (lymc@example.com)"
```

### 1.2 公司提交历史 API

```
https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type={form}&dateb=&owner=include&count=40
```

**用途**：已知发行人 CIK 后，拉取其全部历史 filings。

### 1.3 文件直接访问

```
https://www.sec.gov/Archives/edgar/data/{cik_no_zero}/{accession_no_clean}/{filename}
```

**示例 URL 模式**：
```
https://www.sec.gov/Archives/edgar/data/1815846/000110465920071876/a20-31221_1f1.htm
                                        ↑           ↑                      ↑
                                       CIK   Accession Number       文件名
```

### 1.4 Financial Reports JSON API（备选）

```
https://data.sec.gov/submissions/CIK{cik_padded_to_10}.json
```

**返回**：公司全部历史 submissions（最近 1000 条），含 form type / accession / filing date。

---

## 二、查询模板（按目标类型）

### 2.1 按投行检索

```
# A. F-1 + 投行作为承销商
https://efts.sec.gov/LATEST/search-index?q=%22Goldman+Sachs%22+%22Lead+Bookrunner%22&forms=F-1
https://efts.sec.gov/LATEST/search-index?q=%22Morgan+Stanley%22+%22Joint+Bookrunner%22&forms=F-1
https://efts.sec.gov/LATEST/search-index?q=%22J.P.+Morgan%22+%22underwriters%22&forms=F-1

# B. 424B 最终招股书
https://efts.sec.gov/LATEST/search-index?q=%22Goldman+Sachs%22+%22Representatives%22&forms=424B1,424B3,424B4,424B5

# C. 限定时间段
https://efts.sec.gov/LATEST/search-index?q=%22Goldman+Sachs%22+%22underwriters%22&forms=F-1&dateRange=custom&startdt=2024-01-01&enddt=2024-12-31
```

### 2.2 按律所检索

```
# 中概股发行人法律顾问通常是
https://efts.sec.gov/LATEST/search-index?q=%22Skadden%22+%22Counsel+to+the+Company%22&forms=F-1
https://efts.sec.gov/LATEST/search-index?q=%22Davis+Polk%22+%22as+to+United+States+Federal+law%22&forms=F-1

# 承销商法律顾问
https://efts.sec.gov/LATEST/search-index?q=%22Davis+Polk%22+%22Counsel+to+the+Underwriters%22&forms=F-1
https://efts.sec.gov/LATEST/search-index?q=%22Sullivan+%26+Cromwell%22+%22Counsel+to+the+Underwriters%22&forms=F-1

# Exhibit 5.1 法律意见书（律所合伙人签字）
https://efts.sec.gov/LATEST/search-index?q=%22Skadden%22&forms=EX-5.1
```

### 2.3 按会计师事务所检索

```
# 审计师在 EX-23.1（Consent of Auditor）
https://efts.sec.gov/LATEST/search-index?q=%22PricewaterhouseCoopers%22&forms=EX-23.1
https://efts.sec.gov/LATEST/search-index?q=%22Deloitte+Touche+Tohmatsu%22&forms=EX-23.1

# 中概股审计要求（PCAOB）
https://efts.sec.gov/LATEST/search-index?q=%22PCAOB%22+%22Auditor%22+%22China%22&forms=20-F
```

### 2.4 按行业检索

```
# 中概股科技 IPO
https://efts.sec.gov/LATEST/search-index?q=%22Cayman+Islands%22+%22China%22+%22technology%22&forms=F-1

# 生物医药 IPO
https://efts.sec.gov/LATEST/search-index?q=%22biotechnology%22&forms=F-1,S-1

# AI 公司 IPO
https://efts.sec.gov/LATEST/search-index?q=%22artificial+intelligence%22+%22underwriters%22&forms=F-1,S-1
```

### 2.5 按发行类型

```
# 中概股回流美股二次上市
https://efts.sec.gov/LATEST/search-index?q=%22dual+listing%22+%22Hong+Kong%22&forms=F-1,F-3

# SPAC（壳公司合并上市）
https://efts.sec.gov/LATEST/search-index?q=%22business+combination%22&forms=F-4,S-4
```

---

## 三、Google Dorking（备选）

如果 EDGAR API 限流或不可用：

```
# 直接定位 EDGAR Archives
site:sec.gov inurl:Archives "Goldman Sachs" "underwriters"
site:sec.gov inurl:Archives "F-1" "Lead Bookrunner" 2024

# 法律意见书
site:sec.gov inurl:Archives "Skadden" "Will H. Cai"
site:sec.gov inurl:Archives ext:htm "EX-5.1" "Davis Polk"

# Final prospectus（424B）
site:sec.gov "424b" "Goldman Sachs" 2024
```

---

## 四、备选数据源（EDGAR 不可用时）

### 4.1 IPO 新闻聚合

```
# 中概股美股 IPO 中文媒体
"中概股" "美股 IPO" 承销商 2024 site:36kr.com
"美股 IPO" 承销商 高盛 2024 site:cls.cn

# 英文媒体
site:reuters.com "F-1" "Goldman Sachs" 2024
site:wsj.com "underwriters" "China IPO" 2024
site:ft.com "Lead Bookrunner" "Hong Kong" 2024
```

### 4.2 IPO 数据库

```
"Renaissance Capital" 2024 IPO list
site:nasdaq.com "F-1" 2024
site:nyse.com listings 2024
```

---

## 五、API 调用规范

### 5.1 必备请求头

SEC EDGAR **强制要求** User-Agent 包含联系信息：

```python
HEADERS = {
    "User-Agent": "Lymc Mapping Bot (your@email.com)",
    "Accept-Encoding": "gzip, deflate",
    "Host": "www.sec.gov",
}
```

如果 UA 不合规，会返回 403。

### 5.2 频率限制

- **官方限制**：≤ 10 req/sec
- **建议实践**：≤ 5 req/sec，请求间隔 200ms+

### 5.3 错误处理

| HTTP 状态 | 含义 | 处理 |
|-----------|------|------|
| 200 | 成功 | 解析 |
| 403 | UA 不合规 / 频率超限 | 重试前等 5 秒 + 加 UA |
| 429 | 频率超限 | 指数退避：5/15/45 秒 |
| 5xx | SEC 服务器临时问题 | 重试 3 次 |

---

## 六、常见美股 IPO 中介机构

### 6.1 投行

**Bulge Bracket（一线外资）**：
- Goldman Sachs / Morgan Stanley / JPMorgan / BofA / Citi / Credit Suisse / UBS / Barclays / Deutsche Bank / Wells Fargo

**Boutique（精品投行）**：
- Jefferies / Cowen / Lazard / Evercore / Moelis / Centerview

**中资投行（中概股美股 IPO 常见）**：
- CICC / Haitong International / CMB International / Tiger Brokers / 老虎证券 / Futu / 富途 / UP Fintech

### 6.2 律所（中概股发行人 Counsel）

- Skadden, Arps, Slate, Meagher & Flom (Skadden) — 中概股最大份额
- Simpson Thacher & Bartlett
- Cleary Gottlieb Steen & Hamilton
- Davis Polk & Wardwell
- Latham & Watkins
- Kirkland & Ellis (Bloks 用过)
- Wilson Sonsini Goodrich & Rosati（科技公司）

### 6.3 律所（承销商 Counsel）

- Davis Polk & Wardwell — 承销商 counsel 最常见
- Sullivan & Cromwell
- Cleary Gottlieb Steen & Hamilton
- Shearman & Sterling
- Cravath, Swaine & Moore

### 6.4 律所（PRC Law - 中概股必备）

- 方达 (Fangda Partners)
- 君合 (JunHe LLP)
- 通力 (Llinks Law Offices)
- 海问 (HaiWen)
- 中伦 (ZhongLun)
- 金杜 (King & Wood Mallesons)
- 嘉源 (Jia Yuan)

### 6.5 会计师（PCAOB 注册）

- PwC / Deloitte / KPMG / EY (Big 4)
- BDO / Mazars (二线)
- Marcum / Friedman LLP（中概股审计常见）

### 6.6 行业顾问

- Frost & Sullivan (弗若斯特沙利文) — 中国行业研究
- iResearch (艾瑞)
- CIC (China Insights Consultancy)

---

## 七、推荐检索顺序（实战）

```
Step 1: EDGAR 全文搜索 API
        https://efts.sec.gov/LATEST/search-index?q=...&forms=F-1
        → 拿到 filing 列表

Step 2: 对每个 filing，拿到 HTML URL（在返回的 hits[].adsh + hits[].file_type 字段）

Step 3: web_fetch 主 HTML（招股书全文）
        通常在 /Archives/edgar/data/{cik}/{accession}/ 下面
        文件名规律：{ticker}_xxx.htm 或 a{date}_xxx.htm

Step 4: 抽取关键章节（UNDERWRITING / EXPERTS / LEGAL MATTERS）

Step 5: web_fetch 关键 Exhibit
        - EX-1.1 (Underwriting Agreement)
        - EX-5.1 (Legal Opinion - Issuer Counsel)
        - EX-8.1 (Tax Opinion)
        - EX-23.1 (Consent of Auditor)

Step 6: LLM 解析为结构化 JSON

Step 7: 入库 + 渲染
```
