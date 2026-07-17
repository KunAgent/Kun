---
name: westock-data
description: 查询A股、港股、美股个股/指数/ETF的详细数据，包括：实时行情、K线/分时、财务报表（三大报表多期查询，支持跨市场批量对比）、资金流向、技术指标、筹码分析、机构评级/研报/一致预期、个股新闻/公告/研报、市场资讯、风险事件（质押/解禁/诉讼/ST警示/增发等）、股东结构、分红除权、业绩预告、公司简况、ETF基金数据（详情/持仓/净值/持有人/公司信息）；以及大盘指数、行业/板块行情、板块/概念成份股（申万行业/聚源概念）、板块区间涨幅排行、指数成份股、陆股通成份股、热搜、股单、新股日历、投资日历、脱水研报等市场数据；宏观经济数据（GDP/CPI/PPI/PMI/工业利润/消费/投资/货币供给/利率等）。
---

# WeStock Data

**数据源**：腾讯自选股行情数据接口 | **支持市场**：A股（沪深/科创/北交所）、港股、美股

> **与 其他工具 的分工**：
> - **westock-data**（本工具）：查询个股详情 — "查某只股票的行情/K线/财务/资金等数据"、"查某只股票的风险事件"、"查宏观经济数据"、"查某只股票的新闻/公告/研报"、"查市场资讯"、"查陆股通成份股"、"查ETF详情/持仓/持有人"、**"查板块/概念成份股"**（如"华为概念有哪些股票"→ `sector --search 华为` → `sector <代码>`）。`watchlist` 命令查的是**热门股单**（公开数据），非用户自选股
> - **westock-tool**：筛选/选股 — "找出满足条件的股票列表"（注意：概念股查询不属于选股，属于板块成份股查询，用 westock-data sector）
> - **westock-portfolio**：**用户自选股管理** — "查看我的自选股列表"、"加自选"、"删自选"（需 APIKEY，与 westock-data watchlist 不同）

---

## 已知限制速查

| 限制项 | 说明 |
|--------|------|
| 风险事件 | 仅支持A股（sh/sz/bj），**港股美股不支持 `risk` 命令** |
| 龙虎榜 | 仅支持A股 |
| 大宗交易/融资融券 | 仅支持沪深市场（sh/sz） |
| 筹码成本 | 仅支持沪深京A股（sh/sz/bj） |
| 股东结构 | 仅支持A股和港股 |
| 货币单位 | 港股返回港元/美元，美股返回美元，展示时必须标注正确货币单位，禁止使用人民币符号 |
| `search`/`minute` | 不支持批量查询 |

---

## 批量查询

**所有查询类命令均支持逗号分隔多股代码**，返回 Markdown 表格（每个 symbol 独立表格）。

```bash
westock-data quote sh600000                      # 单股
westock-data quote sh600000,sz000001,hk00700     # 批量
```

> `search` 和 `minute` 不支持批量查询。详细返回格式见 [references/ai_usage_guide.md](./references/ai_usage_guide.md)

**通用参数**（各命令均可使用，另有特有参数见具体命令说明）：

| 参数 | 说明 | 适用命令 |
|------|------|----------|
| `--date` | 指定日期 `YYYY-MM-DD`，默认今天 | 资金流向、技术指标、龙虎榜等 |
| `--start` / `--end` | 区间查询起止日期 | 资金流向、技术指标、筹码、K线等 |
| `--limit` | 返回数量限制 | 大部分查询命令 |
| `--num` | 返回期数（如 `--num 4` 返回最近4期） | finance（财务报表） |
| `--days` | 分时天数（如 `--days 5`） | minute（分时数据） |
| `--tab` | 龙虎榜标签（如 `--tab jg,yzb`） | lhb |
| `--types` | 风险事件类型（如 `--types pledge,unlock`） | risk |

---

## 核心命令

### 1. 股票搜索

```bash
westock-data search 腾讯控股          # 搜索股票（默认）
westock-data search 腾讯 --stock     # 搜索股票（显式）
westock-data search 华夏 --fund      # 搜索基金/ETF
westock-data search 银行 --sector    # 搜索板块（仅返回板块名称和代码，不含成份股）
```

> ⚠️ **注意**：`search --sector` 只返回板块列表（名称+代码），**不会返回板块内的成份股**。要查询板块/概念的成份股，请用 `sector --search` + `sector <代码>` 两步查询（见下方"板块成份股"章节）。

### 2. 实时行情

> 支持个股、指数、板块、ETF

```bash
westock-data quote sh600000
westock-data quote sh600000,sz000001,hk00700
westock-data quote sh000001                              # 指数行情
westock-data quote pt01801081                            # 板块行情
westock-data quote sh600000 --date 2026-03-20            # 指定历史日期
```

**返回**：价格、涨跌幅、成交量/额、换手率、PE/PB、总/流通股本、股息率TTM、量比、振幅、52周高低、多日涨跌幅等

### 3. 股票评分

> 查询个股最新评分及周/月/季变动

```bash
westock-data score sh600519                          # 单股评分
westock-data score sh600519,sz000001                  # 多股评分
westock-data score sh600519 --date 2026-04-10         # 指定日期
```

**返回**：最新评分、评分周变动、评分月变动、评分季变动

### 4. K线

> 支持个股、指数、板块、ETF

```bash
westock-data kline sh600000 --period day --limit 20
westock-data kline hk00700 --period week --limit 10
westock-data kline usAAPL --period m30 --limit 50
westock-data kline sz000001 --period day --limit 60 --fq qfq          # 前复权
westock-data kline sh600000,sh600519 --period day --limit 20     # 批量
westock-data kline sh000001 --period day --limit 20               # 指数K线
westock-data kline pt01801081 --period day --limit 20             # 板块K线
```

**周期**：`day`/`week`/`month`/`season`/`year`（⚠️ 分钟K线不支持，请用 `minute`）

**复权**：默认前复权、`qfq`(前复权)、`hfq`(后复权)、`bfq`(不复权)，最大2000条

### 5. 分时

> 支持个股、指数、板块

```bash
westock-data minute sh600000        # 1日分时
westock-data minute sh600000 --days 5      # 5日分时
westock-data minute sh000001        # 指数分时
westock-data minute pt01801081      # 板块分时
```

### 6. 财务报表

> 默认返回最新1期，数字参数指定多期

```bash
# A股：lrb(利润表) / zcfz(资产负债表) / xjll(现金流量表)
westock-data finance sh600000           # 完整财报，最新1期
westock-data finance sh600000 --num 4         # 完整财报，最近4期
westock-data finance sh600000 --type lrb --num 8     # 最近8期利润表

# 港股：zhsy(综合损益表) / zcfz / xjll（⚠️ 港股利润表用 zhsy，不是 lrb）
westock-data finance hk00700 --num 4
westock-data finance hk00700 --type zhsy --num 4      # 港股综合损益表

# 美股：income / balance / cashflow
westock-data finance usBABA --type income --num 4
```

> ⚠️ **货币单位**：港股返回港元/美元，美股返回美元，展示时必须标注正确货币单位

### 7. 公司简况

```bash
westock-data profile sh600000
westock-data profile sh600000,hk00700,usAAPL
```

### 8. 资金与交易分析

```bash
# 港股资金
westock-data hkfund hk00700
westock-data hkfund hk00700,hk01810 --date 2026-03-10
westock-data hkfund hk00700 --start 2026-03-01 --end 2026-03-10

# A股资金
westock-data asfund sh600000
westock-data asfund sh600000,sz000001 --date 2026-03-10
westock-data asfund sh600000 --start 2026-03-01 --end 2026-03-10

# 美股卖空
westock-data usfund usAAPL
westock-data usfund usAAPL,usTSLA --date 2026-03-10
westock-data usfund usAAPL --start 2026-03-01 --end 2026-03-10

# 龙虎榜（仅A股，全市场视角，机构榜/游资榜/活跃席位/高胜率买入/高胜率席位）
westock-data lhb
westock-data lhb --tab jg,yzb
westock-data lhb --tab yyb --date 2026-03-20

# 大宗交易（仅沪深）
westock-data blocktrade sz000001
westock-data blocktrade sz000001 --date 2026-03-20

# 融资融券（仅沪深）
westock-data margintrade sz000001
westock-data margintrade sz000001 --date 2026-03-20

# 公司回购（A股/港股）
westock-data buyback sh600519
westock-data buyback hk01810
westock-data buyback hk01810 --start 2026-03-01 --end 2026-04-14

# 风险事件监控（⚠️ 仅A股 sh/sz/bj，港股美股不支持）
westock-data risk sh600000                           # 查看全部风险事件
westock-data risk sz000001 --types pledge,unlock     # 仅查看质押和解禁
westock-data risk sh600000 --types pledge,unlock,lawsuit,st,addition  # 指定多种类型
```

### 9. 新闻与研究

```bash
# 新闻列表（--limit/--type：0=公告,1=研报,2=新闻,3=全部）
westock-data news sh600000
westock-data news sh600000 --limit 20 --type 2

# 市场资讯（沪深/港股整体市场新闻，非个股新闻）
westock-data marketnews hs              # 沪深市场资讯
westock-data marketnews hk              # 港股市场资讯
westock-data marketnews us              # 美股市场资讯

# 新闻详情（id 来自 news 返回的 id 字段）
westock-data newsdetail nesSN20260320171527a6d852c7

# 公告（类型：0=全部,1=财务,2=配股,3=增发,4=股权变动,5=重大事项,6=风险,7=其他）
westock-data notice sh600000
westock-data notice sh600000 --type 1

# 公告全文（nos=沪深→纯文本；nok=港股/nou=美股→PDF URL）
westock-data ncontent nos1224809143

# 机构评级
westock-data rating sh600000
westock-data rating hk00700,hk09988

# A股一致预期
westock-data consensus sh600519
westock-data consensus sh600519,sh600000

# 研报列表（类型：0=全部,1=研报,2=业绩会）
westock-data report sh600000
westock-data report sh600000 --limit 20
```

### 10. 技术指标

```bash
westock-data technical sh600000                              # 全部指标（最新）
westock-data technical sh600000 --group macd                         # 特定分组
westock-data technical sh600000 --group ma,rsi                       # 多分组
westock-data technical sh600000,hk00700 --group all                  # 批量
westock-data technical sh600000 --group all --date 2026-03-01               # 指定日期
westock-data technical sh600000 --group macd --start 2026-02-01 --end 2026-03-01   # 历史区间
```

**指标分组**：`ma`(均线)、`macd`、`kdj`、`rsi`、`boll`(布林带)、`bias`(乖离率)、`wr`(威廉)、`dmi`(SAR/DMI)、`all`(全部)

### 11. 筹码成本

> ⚠️ 仅支持沪深A股（sh/sz/bj）

```bash
westock-data chip sh600519
westock-data chip sh600519,sz000001
westock-data chip sh600519 --start 2026-02-01 --end 2026-03-01   # 历史区间
```

### 12. 股东结构

> ⚠️ 仅支持A股和港股

```bash
westock-data shareholder sh600519     # A股：十大股东、十大流通股东、股东户数
westock-data shareholder hk00700      # 港股：持股股东+机构持仓
westock-data shareholder sh600519,hk00700
```

### 13. 分红数据

```bash
westock-data dividend sh600519                              # 最近分红
westock-data dividend sh600519 --years 5                    # 近5年分红
westock-data dividend sh600519 --all                        # 含未实施分红方案
westock-data dividend sh600519,hk00700,usAAPL               # 批量
westock-data dividend hk00700 --years 10                    # 近10年分红
```

### 14. ETF 基金数据

> 子命令说明：`etf`(详情)、`etf-holdings`(持仓明细)、`etf-nav`(净值历史)、`etf-company`(公司信息)、`etf-holders`(持有人结构)、`etf-financial`(财务指标)。注意 `etf-company` 和 `etf-holders` 是独立子命令，不是 `etf` 的参数。

```bash
westock-data etf sh510300                  # ETF 详情
westock-data etf-holdings sh510300         # ETF 持仓明细
westock-data etf-nav sh510300 --start 2026-01-01 --end 2026-03-31   # ETF 净值历史
westock-data etf-company sh510300          # ETF 公司信息
westock-data etf-holders sh510300          # ETF 持有人结构
westock-data etf-financial sh510300        # ETF 财务指标
```

> 以上命令均支持逗号分隔批量查询。详细字段说明见 [references/ai_usage_guide.md](./references/ai_usage_guide.md)

---

## 市场/指数/板块

**常用指数**：`sh000001`(上证)、`sz399001`(深证成指)、`sz399006`(创业板)、`hkHSI`(恒生)、`us.IXIC`(纳斯达克)、`us.INX`(标普500)

```bash
westock-data quote sh000001                              # 指数实时行情
westock-data quote sh000001,sz399001,hkHSI               # 批量查询
```

```bash
westock-data changedist hs              # 沪深涨跌区间分布
westock-data changedist hk              # 港股涨跌区间分布
```

```bash
# 陆股通成份股（查询沪深港通标的股票列表）
westock-data lgt sh                     # 沪股通成份股
westock-data lgt sz                     # 深股通成份股
westock-data lgt sz --limit 50 --offset 50               # 深股通第2页，每页50条
```

---

## 平台特色数据

```bash
westock-data hot stock                  # 热搜股票
westock-data hot wx                     # 微信热股
westock-data hot board --limit 10              # 热门板块
westock-data hot etf                    # 热搜ETF

westock-data watchlist rank             # 热门股单列表（⚠️ 非用户自选股）
westock-data watchlist gd000767         # 股单详情

westock-data marketnews hs              # 沪深市场资讯
westock-data marketnews hk              # 港股市场资讯

westock-data board                      # 热门板块首页

# 投资日历（--limit/--country:1中国2美国3港股/--indicator:1经济2央行3事件4休市）
westock-data calendar
westock-data calendar 2026-03-10
westock-data calendar 2026-03-10 --limit 30 --country 1 --indicator 1

westock-data ipo hs                     # 沪深新股
westock-data ipo hk                     # 港股新股

westock-data dehydrated                 # 脱水研报列表
westock-data dehydrated detail 1056     # 研报详情

westock-data exdiv sh600519             # 分红除权日历
westock-data reserve sh600519           # 业绩预告
westock-data suspension hs              # 停复牌信息
```

---

## 宏观经济数据

```bash
westock-data macro --list                                    # 列出所有宏观指标
westock-data macro gdp --year 2025                           # GDP数量指标（按年份查询）
westock-data macro cpi_ppi,pmi --year 2025                   # 多指标同时查询
westock-data macro pmi --start 2024 --end 2025               # PMI区间趋势（年份区间）
westock-data macro core_indicatros_cur --date 2026-03-31     # 最新核心宏观指标（按日期查询）
```

---

## 板块成份股

> ⚠️ **概念股查询必看**：当用户问"XX概念有哪些股票"（如"华为概念股"、"AI概念股"、"新能源汽车概念"），**必须使用 `sector --search` 两步查询**，不要用 `search --sector`：
> 1. `westock-data sector --search 华为` — 搜索板块代码
> 2. `westock-data sector <搜索到的代码>` — 查询成份股

```bash
westock-data sector --types                                          # 查看板块代码格式
westock-data sector --list                                           # 查看可用板块清单
westock-data sector --list industry_list_sw1                         # 申万一级行业清单
westock-data sector --list industry_list_sw1 --limit 20              # 分页：每页20条
westock-data sector --list industry_list_sw1 --limit 20 --offset 20  # 分页：第二页
westock-data sector --search 银行                                     # 搜索名称含"银行"的板块
westock-data sector --search 银行 --in industry_list_sw1              # 在申万一级行业中搜索
westock-data sector --search 华为                                     # 搜索华为概念板块 → 返回板块代码
westock-data sector --search 人工智能                                  # 搜索AI概念板块 → 返回板块代码
westock-data sector --search 新能源                                    # 搜索新能源概念板块 → 返回板块代码
westock-data sector sw1_pt01801080                                  # 申万一级-电子成份股
westock-data sector sw1_pt01801080,sw1_pt01801780                   # 多板块查询
westock-data sector --rank                                           # 查看可用排行清单
westock-data sector --rank interval_chg_rank_sw1                     # 申万一级行业区间涨幅榜
westock-data sector --rank interval_chg_rank_sw1 --sort chg5Days     # 按5日涨幅排序
westock-data sector --rank interval_chg_rank_industry                # 聚源产业概念区间涨幅榜
```

> 板块代码格式：`sw1_`(申万一级) / `sw2_`(申万二级) / `sw3_`(申万三级) / `area_`(地域) / `style_`(产业) / `indus_`(风格) + 板块编码 | 排行清单：`interval_chg_rank_sw1`/`sw2`/`sw3`(申万) / `industry`(产业概念) / `style`(风格概念) / `area`(地域概念) | 排序：`chg5Days`/`chg20Days`/`chg60Days`/`chg120Days`/`chg250Days`

> **概念股查询示例**（聚源概念包括产业概念和风格概念，覆盖华为/AI/新能源/芯片等热门概念）：
> ```
> # 第1步：搜索概念板块代码
> westock-data sector --search 华为        → 找到 style_pt01801517 (华为概念)
> # 第2步：用板块代码查成份股
> westock-data sector style_pt01801517     → 返回华为概念成份股列表
> ```

---

## 指数数据

```bash
westock-data index --list                                           # 查看有行情指数清单
westock-data index --list --limit 50                                # 分页：每页50条
westock-data index --list --limit 50 --offset 50                    # 分页：第二页
westock-data index --search 沪深300                                   # 搜索指数
westock-data index sh000300                                         # 沪深300成份股
westock-data index sh000300,sz399001                                # 多指数成份股
```

> 指数行情查询使用 `quote` 命令（如 `westock-data quote sh000300`）

---

## 股票代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 沪市/科创板 | sh + 6位数字 | `sh600000`、`sh688981` |
| 深市 | sz + 6位数字 | `sz000001` |
| 北交所 | bj + 6位数字 | `bj430047` |
| 港股 | hk + 5位数字 | `hk00700` |
| 港股指数 | hk + 指数代码 | `hkHSI`(恒生) |
| 美股 | us + 代码 | `usAAPL` |
| 美股指数 | us. + 指数代码 | `us.IXIC`(纳斯达克)、`us.INX`(标普500) |

---

## 使用规范

- ✅ 使用 CLI 命令查询数据，命令输出 Markdown 表格，AI 直接从表格中读取数据
- ✅ 查询结果应转为表格或可读格式展示，禁止直接输出原始 JSON
- ❌ 不创建临时脚本文件，不将数据分析逻辑写成独立脚本
- ⚠️ **货币单位**：港股返回港元/美元，美股返回美元，禁止使用人民币符号

---

## 常见分析场景

```
查询股票信息：search 腾讯控股 → quote hk00700
股票评分：score sh600519 → 查看评分及变动
K线分析：kline sz002714 --period day --limit 20 → 提取 volume 计算统计
多股对比：quote hk00700,usBABA → 对比
资金流向：asfund sh688981 → 解析 MainNetFlow/JumboNetFlow
港股资金：hkfund hk00700 → 查港股资金流向
美股卖空：usfund usNVDA → 查美股卖空数据
大宗交易：search 中国中免 → blocktrade sh601888 → 查大宗交易
龙虎榜：lhb → 查全市场龙虎榜（仅A股，机构榜/游资榜/活跃席位/高胜率买入/高胜率席位）
指数/板块：search 半导体 --sector → quote pt01801081 → 查行情
技术指标：technical sh600000 --group macd,rsi → 判断金叉/死叉、超买/超卖
ETF分析：etf sh510300 → etf-holdings sh510300 → 查持仓明细
新闻详情：news sh600000 --limit 20 --type 2 → newsdetail <id> → 查新闻/研报正文
市场资讯：marketnews hs → 查沪深整体市场动态
研报查询：search 比亚迪 → report sz002594 → 查研报列表
公告查询：notice sh600000 → 查看公司公告列表
公告全文：ncontent <id> → 查看公告详细内容
机构评级：rating sh600519 → 查看机构评级汇总
一致预期：consensus sh600519 → 查看业绩一致预期
板块成份：sector sw1_pt01801080 → 查电子行业成份股
概念股查询：sector --search 华为 → 找到板块代码 → sector style_pt01801517 → 查华为概念成份股
AI概念股：sector --search 人工智能 → 找到板块代码 → sector <代码> → 查AI概念成份股
板块排行：sector --rank interval_chg_rank_sw1 --sort chg5Days → 查行业涨幅排行
指数成份：index sh000300 → 查沪深300成份股
宏观经济：macro core_indicatros_cur → 查看最新宏观指标全景
宏观趋势：macro pmi --start 2024 --end 2025 → 分析PMI走势
风险事件：risk sh600000 → 查看浦发银行所有风险事件（⚠️ 仅A股，港股美股不支持）
股权质押：risk sz300750 --types pledge → 查看宁德时代股权质押情况
解禁风险：risk sz300750 --types unlock → 查看宁德时代解禁情况
增发风险：risk sh600000 --types addition → 查看增发风险
ST警示：risk sh600000 --types st → 查看ST风险警示股票
诉讼查询：risk sh600000 --types lawsuit → 查看诉讼仲裁信息
陆股通：lgt sh → 查沪股通成份股 / lgt sz → 查深股通成份股
```

**完整分析场景（33个）参见 [references/scenarios-guide.md](./references/scenarios-guide.md)**

**详细返回格式、字段说明、分析模板参见 [references/ai_usage_guide.md](./references/ai_usage_guide.md)**

---

## 重要声明

> ⚠️ **重要声明**：
>
> 1. 本技能仅提供客观市场数据的查询与展示服务，所有返回数据均来源于公开市场信息，不含任何主观分析、投资评级或交易建议。
> 2. 本技能不构成证券投资咨询服务，使用本技能获取的数据不应作为投资决策的唯一依据。
> 3. 数据可能存在延迟，请以交易所官方数据为准。
> 4. 投资有风险，决策需谨慎。如需专业投资建议，请咨询持牌证券投资顾问机构。

**数据来源**：腾讯自选股数据接口

---

## 附录：环境安装

**环境要求**：Node.js >= v18（脚本为单文件打包，无需 npm install）

> 本文件（SKILL.md）所在目录即为技能根目录，脚本路径为 `scripts/index.js`。

**运行方式**：
```bash
node <SKILL.md所在目录>/scripts/index.js search 茅台
```
