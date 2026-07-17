---
name: westock-data
description: 查询A股、港股、美股个股/指数的详细数据，包括：实时行情、K线/分时、财务报表（三大报表多期查询、财报披露日历，支持跨市场批量对比）、资金流向、技术指标、筹码分析、机构评级/研报/一致预期、新闻公告、股东结构、分红除权、公司简况；以及大盘指数、行业/板块行情、热搜、股单、新股日历、投资日历、脱水研报等市场数据。注意：本工具"查已知股票/指数的数据"；按条件选股（如"PE<20的股票"）请用 westock-tool；**查询用户自选股列表请用 westock-portfolio**
---

# WeStock Data

**数据源**：腾讯自选股行情数据接口 | **支持市场**：A股（沪深/科创/北交所）、港股、美股

> **与 其他工具 的分工**：
> - **westock-data**（本工具）：查询个股详情 — "查某只股票的行情/K线/财务/资金等数据"
> - **westock-tool**：筛选/选股 — "找出满足条件的股票列表"
> - **westock-portfolio**：**用户自选股查询** — "查看我的自选股列表"（当用户说"我的自选股"、"自选股有哪些"时使用）

**环境要求**：Node.js >= v18（脚本为单文件打包，无需 npm install）

如未安装，根据系统自动安装：

```bash
# 检测
node --version 2>/dev/null || echo "未安装"

# macOS / Linux：通过 nvm 安装（无需 sudo）
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash \
  && export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" \
  && nvm install --lts && nvm use --lts
```

```powershell
# Windows PowerShell
if (-not (Get-Command node -EA SilentlyContinue)) { winget install OpenJS.NodeJS.LTS }
```

**运行方式**：
```bash
node <skill-path>/scripts/index.js search 茅台
```

---

## 批量查询

**所有查询类命令均支持逗号分隔多股代码**，返回 `BatchResult` 结构（`status` + `data[]` + `errors[]` + `metadata`）。

```bash
westock-data quote sh600000           # 单股
westock-data quote sh600000,sz000001,hk00700  # 批量（返回 BatchResult）
```

> `search` 和 `minute` 不支持批量查询。详细 BatchResult 结构见 [references/ai_usage_guide.md](./references/ai_usage_guide.md)

---

## 核心命令

### 1. 股票搜索

```bash
westock-data search 腾讯控股
westock-data search 华夏 fund       # 搜索基金
westock-data search 科技 sector     # 搜索板块
```

### 2. 实时行情

**包含**：价格、涨跌幅、成交量/额、换手率、PE/PB/PS/PCF、总/流通股本、股息率TTM、量比、振幅、52周高低、多日涨跌幅等

```bash
westock-data quote sh600000
westock-data quote sh600000,sz000001,hk00700
```

### 3. K线

```bash
westock-data kline sh600000 day 20
westock-data kline hk00700 week 10
westock-data kline usAAPL m30 50
westock-data kline sz000001 day 60 qfq    # 前复权
westock-data kline sh600000,sh600519 day 20
```

**周期**：`day`/`week`/`month`/`season`/`year`（⚠️ 分钟K线不支持，请用 `minute`）

**复权**：空(不复权)、`qfq`(前复权)、`hfq`(后复权)，最大2000条

**返回**：`data.nodes[]` 含 `date`/`open`/`last`(收盘)/`high`/`low`/`volume`/`amount`/`exchange`(换手率%)

### 4. 分时

```bash
westock-data minute sh600000
```

### 5. 财务报表

> 默认返回最新1期，数字参数指定多期

```bash
# A股：lrb(利润表) / zcfz(资产负债表) / xjll(现金流量表)
westock-data finance sh600000           # 完整财报，最新1期
westock-data finance sh600000 4         # 完整财报，最近4期
westock-data finance sh600000 lrb 8     # 最近8期利润表

# 港股：zhsy(综合损益表) / zcfz / xjll
westock-data finance hk00700 4
westock-data finance hk00700 zhsy 4

# 美股：income / balance / cashflow
westock-data finance usBABA 4
westock-data finance usBABA income 4    # 仅利润表
```

> ⚠️ **货币单位**：港股返回港元/美元，美股返回美元，展示时必须标注正确货币单位，禁止使用人民币符号

### 6. 公司简况

```bash
westock-data profile sh600000
westock-data profile sh600000,hk00700,usAAPL
```

### 7. 资金分析

```bash
# 港股（TotalNetFlow/MainNetFlow/ShortRatio/LgtHoldInfo）
westock-data hkfund hk00700
westock-data hkfund hk00700 2026-03-10
westock-data hkfund hk00700,hk01810 2026-03-10

# A股（MainNetFlow/JumboNetFlow/BlockNetFlow/MainInflowRank）
westock-data asfund sh600000
westock-data asfund sh600000,sz000001 2026-03-10

# 美股卖空（ShortRatio/ShortShares/ShortRecoverDays）
westock-data usfund usAAPL
westock-data usfund usAAPL,usTSLA 2026-03-10
```

### 8. 新闻与研究

```bash
# 新闻列表（类型：0=公告/1=研报/2=新闻/3=全部）
westock-data news sh600000
westock-data news sh600000 1 20 2       # 页码/每页/类型
westock-data news sh600000,sh600519

# 新闻详情（从列表获取ID后查询正文）
westock-data newsdetail nesSN20260320171527a6d852c7
westock-data newsdetail nesSN20260320171527a6d852c7 --raw

# 公告（类型：0=全部/1=财务/2=配股/3=增发/4=股权变动/5=重大事项/6=风险/7=其他）
westock-data notice sh600000
westock-data notice sh600000 1          # 财务报告
westock-data notice sh600000,sz000001

# 公告全文（nos=沪深/nob=北交所→纯文本；nok=港股/nou=美股→PDF URL）
westock-data ncontent nos1224809143
westock-data ncontent nos1224809143 --raw

# 机构评级（A股返回评级统计+近期研报；港股/美股返回目标价区间+盈利预测）
westock-data rating sh600000
westock-data rating hk00700,hk09988

# A股一致预期（目标价+分年度预测：营收/净利润/EPS/PE/增速/机构数）
westock-data consensus sh600519
westock-data consensus sh600519,sh600000

# 研报列表（类型：0=全部/1=研报/2=业绩会）
westock-data report sh600000
westock-data report sh600000 1 20 1
```

> ⚠️ **数据源限制**：港股/美股机构评级字段（评级数量、目标价等）MCP服务暂不返回数据，当前仅港股盈利预测可用

### 9. 技术指标

```bash
westock-data technical sh600000             # 全部指标（最新）
westock-data technical sh600000 macd        # 特定分组
westock-data technical sh600000 ma,rsi      # 多分组
westock-data technical sh600000,hk00700 all # 批量
westock-data technical sh600000 all 2026-03-01              # 指定日期
westock-data technical sh600000 macd 2026-02-01 2026-03-01  # 历史区间
```

**指标分组**：`ma`(均线)、`macd`、`kdj`、`rsi`、`boll`(布林带)、`bias`(乖离率)、`wr`(威廉)、`dmi`(SAR/DMI)、`all`(全部)

### 10. 筹码成本

> ⚠️ 仅支持沪深A股（sh/sz/bj）

```bash
westock-data chip sh600519
westock-data chip sh600519,sz000001
westock-data chip sh600519 2026-03-01
westock-data chip sh600519 2026-02-01 2026-03-01
```

**关键字段**：`chipProfitRate`(盈利率%)、`chipAvgCost`(平均成本)、`chipConcentration90/70`(集中度%)

### 11. 股东结构

> ⚠️ 仅支持A股和港股

```bash
westock-data shareholder sh600519     # A股：十大股东+十大流通股东
westock-data shareholder hk00700      # 港股：持股股东+股东分布+机构持仓
westock-data shareholder sh600519,hk00700
```

### 12. 分红数据

```bash
# 分红指标（A股/港股/美股）
westock-data dividend sh600519
westock-data dividend sh600519,hk00700,usAAPL

# 分红历史（仅港股/美股）
westock-data dividend history hk00700
westock-data dividend history hk00700,usAAPL
```

**关键字段**：`dividendRatioTTM`(股息率TTM%)、`dividendTTM`(股息TTM)、`dividendPS`(每股股利,A股)

---

## 市场/指数/板块

**代码获取**：`westock-data search 上证指数` → `sh000001`；`westock-data search 半导体 sector` → `pt01801081`

**常用指数**：`sh000001`(上证)、`sz399001`(深证成指)、`sz399006`(创业板)、`hkHSI`(恒生)、`us.IXIC`(纳斯达克)、`us.INX`(标普500)

```bash
# 截面查询
westock-data market sh000001
westock-data market sh000001,sz399001,hkHSI
westock-data market sh000001 2026-03-01

# 历史区间
westock-data market sh000001 2026-02-01 2026-03-01
westock-data market sh000001,sz399001 2026-02-01 2026-03-01
```

**返回**：收盘价、涨跌幅、成交量/额、多日涨幅、上涨/下跌家数、资金流向（沪深+港股支持，美股不支持）

### 涨跌区间分布

**查询全市场涨跌区间分布**，展示各涨幅区间的股票数量和占比，帮助快速了解市场整体强弱。

```bash
westock-data changedist hs           # 沪深市场（最新）
westock-data changedist hs 2026-03-20  # 指定日期
westock-data changedist hk           # 港股市场
```

**返回字段**：
- `totalStocks`：总股票数
- `advancing`/`declining`/`unchanged`：上涨/下跌/平盘数量
- `limitUp`/`limitDown`：涨停/跌停数量（仅沪深）
- `ranges[]`：11 个涨跌区间分布
  - 涨停、>7%、5%~7%、2%~5%、0%~2%、平、0%~-2%、-2%~-5%、-5%~-7%、<-7%、跌停

**使用场景**：
- 快速判断市场强弱：上涨家数多=强势市场，下跌家数多=弱势市场
- 涨停/跌停数量：情绪极端程度
- 区间分布：资金活跃度（大涨大跌多=活跃）

---

## 平台特色数据

### 热搜

```bash
westock-data hot stock      # 热搜股票
westock-data hot wx         # 微信热股
westock-data hot news 20    # 热文排名
westock-data hot board 10   # 热门板块
westock-data hot etf        # 热搜ETF
```

### 股单

```bash
westock-data watchlist rank                         # 热门股单列表
westock-data watchlist rank updateTime 10           # 指定排序和数量
westock-data watchlist rank updateTime 10 --page 2  # 翻页
westock-data watchlist gd000767                     # 股单详情
```

### 市场资讯

```bash
westock-data marketnews hs          # 沪深市场资讯（含相关指数+新闻）
westock-data marketnews hk          # 港股市场资讯
westock-data marketnews us          # 美股市场资讯
westock-data marketnews sh,sz       # 自定义指数组合资讯
```

**预设市场**：`hs`(沪深)、`sh`(沪市)、`sz`(深市)、`hk`(港股)、`us`(美股)，或逗号分隔自定义指数代码

**返回**：`indexes[]`（关联指数）+ `news[]`（标题/时间/来源/URL）+ 去重统计

### 行业概念

```bash
westock-data board    # 热门板块首页（行业资金流向、涨幅排名、北向资金等）
```

### 投资日历

```bash
westock-data calendar                           # 有重要事件的日期列表
westock-data calendar 2026-03-10                # 某日事件详情
westock-data calendar 2026-03-10 30 1           # 按地区筛选（1中/2美/3港...）
westock-data calendar 2026-03-10 30 1 1         # 按指标筛选（1经济/2央行/3事件/4休市）
```

### 新股日历

```bash
westock-data ipo hs         # 沪深新股（默认90天）
westock-data ipo hk         # 港股新股
westock-data ipo us         # 美股新股
westock-data ipo hs 60      # 指定天数
```

### 脱水研报

```bash
westock-data dehydrated           # 列表，第1页，每页10条
westock-data dehydrated 2         # 第2页
westock-data dehydrated 1 20      # 每页20条
westock-data dehydrated detail 1056  # 研报详情（传入研报ID）
```

### 财报披露日历

```bash
westock-data earnings sh600519
westock-data earnings hk00700
westock-data earnings usAAPL
westock-data earnings sh600519,hk00700
```

> ⚠️ A股/港股正常，**美股暂不支持**

### 分红除权日历

> ⚠️ 仅支持港股和美股

```bash
westock-data exdiv hk00700
westock-data exdiv usAAPL
westock-data exdiv hk00700,usAAPL
```

---

## 股票代码格式

| 市场 | 格式 | 示例 |
|------|------|------|
| 沪市/科创板 | sh + 6位数字 | `sh600000`、`sh688981` |
| 深市 | sz + 6位数字 | `sz000001` |
| 港股 | hk + 5位数字 | `hk00700` |
| 美股 | us + 代码 | `usAAPL` |

---

## 使用规范

- ✅ 使用 CLI 命令查询原始数据，AI 在内存中解析 JSON 并分析计算
- ❌ 不创建临时脚本文件，不将数据分析逻辑写成独立脚本

---

## 常见分析场景

```
查询股票信息：search 腾讯控股 → quote hk00700
K线分析：search 牧原股份 → kline sz002714 day 20 → 提取 volume 计算统计
多股对比：quote hk00700,BABA.N → 解析 BatchResult → 对比
资金流向：asfund sh688981 → 解析 MainNetFlow/JumboNetFlow
指数/板块：search 半导体 sector → market pt01801081 2026-02-10 2026-03-10
技术指标：technical sh600000 macd,rsi → 判断金叉/死叉、超买/超卖
```

**完整分析场景（29个）参见 [references/scenarios-guide.md](./references/scenarios-guide.md)**

**数据格式、分析模板、示例对话参见 [references/ai_usage_guide.md](./references/ai_usage_guide.md)**
