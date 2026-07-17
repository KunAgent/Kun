# WeStock Data - 常见分析场景详解

> **定位**：本文档是 SKILL.md 的 **L3 层补充材料**，提供完整的分析场景示例和详细操作步骤。
>
> **使用方式**：AI 在遇到不确定的分析场景时按需加载本文档。命令列表和基本用法请参见
> [SKILL.md](../SKILL.md)。

---

## 一、基础查询场景

### 场景 1：查询股票基本信息

```
用户："查询腾讯控股的股价"
→ westock-data search 腾讯控股 → 获取 hk00700 → westock-data quote hk00700 → 展示价格和涨跌幅
```

### 场景 2：分析成交量趋势

```
用户："分析牧原股份近20天的成交量"
→ westock-data search 牧原股份 → westock-data kline sz002714 --period day --limit 20 → 从表格中提取volume → 计算统计指标 → 输出分析报告
```

### 场景 3：财务分析

```
用户："分析贵州茅台的盈利能力"
→ westock-data finance sh600519 → 提取关键指标 → 计算同比/环比 → 输出分析结论
```

### 场景 4：多股对比（使用批量查询）

```
用户："对比腾讯和阿里巴巴的市值"
→ westock-data quote hk00700,usBABA → 一次查询两只股票 → 解析批量查询结果 → 提取市值 → 输出对比
```

---

## 二、资金分析场景

### 场景 5：批量资金流向分析

```
用户："对比腾讯和美团的资金流向"
→ westock-data hkfund hk00700,hk03690 --date 2026-03-10 → 一次查询两只 → 解析批量查询结果 → 对比资金面
```

### 场景 6：A股资金流向分析

```
用户："分析中芯国际的资金面"
→ westock-data asfund sh688981 → 解析 MainNetFlow/JumboNetFlow → 输出资金面判断
```

### 场景 7：港股资金分析

```
用户："腾讯控股的资金流向情况"
→ westock-data hkfund hk00700 → 解析 TotalNetFlow/ShortRatio/LgtHoldInfo → 输出资金分析
```

---

## 三、研报与基本面研究场景

### 场景 8：分红数据查询

```
用户："贵州茅台的分红情况如何？"
→ westock-data search 贵州茅台 → 获取 sh600519
→ westock-data dividend sh600519 → 解析分红明细（reportEndDate, dividendPlan, cashDiviRMB 等）
→ 输出分红情况分析
```

### 场景 9：跨市场分红历史对比

```
用户："对比腾讯和苹果近3年的分红记录"
→ westock-data dividend hk00700,usAAPL --years 3
→ 解析批量查询结果 中各股票的 plans[]
→ 注意货币差异：港股 cashDivPerShare（港元）、美股 dividend（美元）
→ 输出跨市场分红对比分析
```

### 场景 10：财报多期对比分析

```
用户："看看浦发银行和招商银行最近4期的利润表"
→ westock-data finance sh600000,sh600036 --type lrb --num 4
→ 解析批量查询结果 → 提取各期营收、净利润、毛利率
→ 计算同比/环比增长率 → 输出两家银行盈利能力对比

用户："查看腾讯最近4期的综合损益表"
→ westock-data finance hk00700 --type zhsy --num 4    # ⚠️ 港股用 zhsy，不是 lrb
```

---

## 四、指数与板块场景

### 场景 11：指数行情查询

```
用户："查一下今天大盘的涨跌情况"
→ westock-data search 上证指数 → 获取 sh000001 → westock-data quote sh000001 → 展示涨跌幅和成交额
```

### 场景 12：多指数对比

```
用户："对比沪深两市今天的表现"
→ westock-data quote sh000001,sz399001 → 解析批量查询结果 → 对比涨跌幅 → 输出分析
```

### 场景 13：板块行情分析

```
用户："半导体板块今天的涨跌情况"
→ westock-data search 半导体 --sector → 获取 pt01801081 → westock-data quote pt01801081 → 展示涨跌幅和成交额
```

### 场景 13.1：指数/板块K线分析

```
用户："上证指数近一个月的走势"
→ westock-data kline sh000001 --period day --limit 30 → 解析K线数据 → 计算区间涨跌幅 → 输出趋势分析

用户："半导体板块近一周的K线走势"
→ westock-data search 半导体 --sector → 获取 pt01801081
→ westock-data kline pt01801081 --period day --limit 5 → 解析K线 → 输出走势
```

### 场景 13.2：指数/板块分时走势

```
用户："大盘今天的分时走势怎么样"
→ westock-data minute sh000001 → 解析分时数据 → 输出走势分析

用户："半导体板块今天的盘中走势"
→ westock-data search 半导体 --sector → 获取 pt01801081
→ westock-data minute pt01801081 → 解析分时 → 输出走势
```

### 场景 14：跨市场指数对比

```
用户："对比恒生指数和纳斯达克今天的表现"

AI 步骤：
1. 批量查询行情：westock-data quote hkHSI,us.IXIC
2. 分别解析各指数的行情数据
3. 对比涨跌幅
4. 输出跨市场指数对比分析
```

---

## 五、平台特色数据场景

### 场景 15：查看市场热搜

```
用户："今天市场有哪些热门股票？"

AI 步骤：
1. 查询热搜股票：westock-data hot stock
   → 格式化输出排名、名称、代码、最新价、涨跌幅
2. 可选：查询微信热股：westock-data hot wx
3. 可选：查询热门板块：westock-data hot board
4. 可选：查询热搜ETF：westock-data hot etf
5. 可选：查询热文排名：westock-data hot news --limit 20
6. 直接基于格式化输出，综合输出市场热点概览
```

### 场景 16：浏览股单

```
用户："有什么好的选股策略推荐？"

AI 步骤：
1. 查询热门股单列表：westock-data watchlist rank
   → 格式化输出股单名称、ID、描述、持仓数、平均涨跌幅、关注人数、分页信息
2. 可选翻页：westock-data watchlist rank --sort updateTime --limit 20 --offset 20
3. 选择感兴趣的股单查询详情：westock-data watchlist gd000767
   → 格式化输出股单信息、成分股列表（按涨跌幅排序）
4. 直接基于格式化输出，输出股单推荐列表
```

### 场景 17：行业板块分析

```
用户："今天哪些行业板块涨得好？资金在流向哪里？"

AI 步骤：
1. 查询板块首页：westock-data board
   → 格式化输出行业/概念/地域板块资金流向（净流入TOP和净流出TOP）、北向资金热门板块（当日/近5日/近20日）
2. 直接基于格式化输出，输出行业板块资金面和涨幅分析
```

### 场景 18：投资日历查询

```
用户："本周有哪些重要的财经事件？"

AI 步骤：
1. 查询有事件的日期：westock-data calendar
   → 格式化输出月历视图，★ 标记有事件的日期
2. 从月历中筛选本周日期
3. 逐日查询事件详情：westock-data calendar 2026-03-10 --limit 30
   → 格式化输出事件列表（按重要性排序），含星级、时间、国家、内容、前值/预测/实际值
4. 可按地区筛选：westock-data calendar 2026-03-10 --limit 30 1  // 仅中国
5. 可按指标筛选：westock-data calendar 2026-03-10 --limit 30 --country 1 --indicator 1  // 仅经济数据
6. 直接基于格式化输出，输出本周财经事件日历
```

### 场景 19：新股申购分析

```
用户："最近有什么新股可以申购？"

AI 步骤：
1. 查询沪深新股：westock-data ipo hs
   → 格式化输出按状态分类（即将发行/今日可申购/即将上市/中签号公布/已上市），含发行价、市盈率、申购代码、上市日、可比公司、风险提示等
2. 可选：查询港股新股：westock-data ipo hk
   → 格式化输出按申购日/上市日分类，含入场费、认购倍数、募集金额等
3. 可选：查询美股新股：westock-data ipo us
   → 格式化输出按状态分组（注册中/已定价/已提交等），含行业、发行价、价格区间、承销商等
4. 可选：指定查询天数：westock-data ipo hs --days 60
5. 直接基于格式化输出，输出新股申购机会分析
```

### 场景 20：公告全文查询

```
用户："查看贵州茅台最近的财务公告内容"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询公告列表：westock-data notice sh600519 --type 1  // 类型1=财务报告
3. 从列表中获取公告ID（如 nos1224809143）
4. 查询公告内容：westock-data ncontent nos1224809143
   → 格式化输出标题、发布时间、关联股票、相关链接（PDF/原文/翻译），A股/北交所直接展示正文内容，港股/美股展示PDF下载链接
5. 直接基于格式化输出，输出公告内容摘要
```

---

## 六、深度分析场景

### 场景 21：筹码成本分析

```
用户："分析一下茅台的筹码分布情况"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询筹码数据：westock-data chip sh600519
3. 解析筹码盈利率（chipProfitRate）→ 判断获利盘/套牢盘比例
4. 对比收盘价与平均成本（chipAvgCost）→ 判断当前价位相对筹码成本的位置
5. 分析集中度（chipConcentration90/70）→ 集中度越低，筹码越集中
6. 输出筹码分析结论
```

### 场景 22：筹码趋势分析

```
用户："看看招商银行近一个月的筹码变化趋势"

AI 步骤：
1. 搜索股票：westock-data search 招商银行 → sh600036
2. 查询历史筹码：westock-data chip sh600036 --start 2026-02-10 --end 2026-03-10
3. 解析 items[] 中每日的筹码数据
4. 分析趋势：
   - 盈利率趋势（上升 = 获利盘增加）
   - 平均成本趋势（上升 = 筹码成本抬升，主力可能在建仓）
   - 集中度趋势（下降 = 筹码趋于集中，可能有主力控盘）
5. 输出筹码变化趋势分析
```

### 场景 23：股东研究分析

```
用户："查一下茅台的十大股东"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询股东数据：westock-data shareholder sh600519
3. 解析 top10Shareholders（十大股东）和 top10FloatShareholders（十大流通股东）
4. 解析 shareholderNum（股东户数）→ 总户数/A股户数/环比变动/户均持股
5. 分析持股集中度、机构/个人占比、持股变动趋势
6. 输出股东结构分析报告
```

### 场景 24：港股股东与机构持仓分析

```
用户："腾讯的机构持仓情况怎么样？"

AI 步骤：
1. 查询股东数据：westock-data shareholder hk00700
2. 解析 shareholderInfo（持股股东）→ 主要股东持股比例
3. 解析 shareholderDist（股东分布）→ 各类机构持股情况
4. 解析 instHoldingStats（机构持仓统计）→ 机构数量变化、增减持趋势
5. 输出机构持仓分析
```

### 场景 25：分红数据分析

```
用户："贵州茅台的分红情况如何？"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询分红数据：westock-data dividend sh600519
3. 解析分红明细（reportEndDate, dividendFlag, procedure, dividendPlan, cashDiviRMB 等）
4. 注意：A股分红数据为"每10股派息"（cashDiviRMB）
5. 输出分红情况分析
```

### 场景 26：跨市场分红对比

```
用户："对比腾讯和苹果的分红情况"

AI 步骤：
1. 批量查询分红数据：westock-data dividend hk00700,usAAPL
2. 解析批量查询结果 中各股票的分红方案
3. 对比两只股票的分红记录
4. 输出跨市场分红对比分析
```

### 场景 27：A股分红历史查询

```
用户："查看贵州茅台近5年的分红记录"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询分红历史：westock-data dividend sh600519 --years 5
3. 解析 plans[] 中的分红方案（reportEndDate, cashDiviRMB, dividendPlan）
4. 注意：A股分红数据为"每10股派息"（cashDiviRMB）
5. 分析每年分红趋势（分红金额、分红频次、股利支付率变化）
6. 输出分红历史趋势分析
```

### 场景 28：港股分红历史查询

```
用户："查看腾讯近几年的分红记录"

AI 步骤：
1. 查询分红历史：westock-data dividend hk00700 --years 5
2. 解析 plans[] 中的分红方案
3. 分析每年分红趋势（每股派息、合计派现、分红频次）
4. 输出分红历史趋势分析
```

### 场景 29：分红历史自定义年数

```
用户："查看苹果近10年的分红记录"

AI 步骤：
1. 查询分红历史：westock-data dividend usAAPL --years 10
2. 解析 plans[] 中的分红方案
3. 分析美股季度分红特征（每季度分红金额、年度累计）
4. 注意：美股可能包含 splitInfo（拆合股信息）
5. 输出长期分红趋势分析
```

### 场景 30：跨市场分红历史对比

```
用户："对比贵州茅台、腾讯和苹果近3年的分红情况"

AI 步骤：
1. 批量查询分红历史：westock-data dividend sh600519,hk00700,usAAPL --years 3
2. 解析批量查询结果 中各股票的 plans[]
3. 注意各市场数据格式差异：
   - A股：cashDiviRMB（每10股派息，元）
   - 港股：cashDivPerShare（每股派息，港元）
   - 美股：dividend（每股分红，美元）
4. 统一换算为每股派息金额进行对比
5. 输出跨市场分红对比分析
```

### 场景 31：财报披露日查询

```
用户："茅台什么时候发财报？"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询业绩预告：westock-data reserve sh600519
3. 解析 items[] 中的披露日列表
4. 区分已披露和预约披露日期
5. 输出最近的财报披露日历
```

### 场景 32：分红除权日查询

```
用户："苹果什么时候除权派息？"

AI 步骤：
1. 搜索股票：westock-data search 苹果 → usAAPL
2. 查询分红除权日：westock-data exdiv usAAPL
3. 解析 items[] 中的除权日列表
4. 展示每次的除权日、支付日、每股分红
5. 输出分红除权日历
```

---

## 七、宏观经济数据场景

### 场景 33：查看最新核心宏观指标

```
用户："当前宏观经济面怎么样？"

AI 步骤：
1. 查询最新核心宏观指标：westock-data macro core_indicatros_cur
2. 解析返回的各项核心指标数据
3. 从 GDP 增速、CPI/PPI、PMI、社融、M2 等维度综合分析
4. 输出宏观经济面全景概览
```

### 场景 34：PMI 趋势分析

```
用户："看看最近半年PMI走势"

AI 步骤：
1. 查询 PMI 区间数据：westock-data macro pmi --start 2024 --end 2025
2. 提取每月 PMI 数值（制造业/非制造业/综合）
3. 分析 PMI 是否连续处于荣枯线（50）以上
4. 结合子项（新订单、生产、就业等）分析经济景气度变化
5. 输出 PMI 趋势分析报告
```

### 场景 35：GDP 全景分析

```
用户："分析一下最新的GDP数据"

AI 步骤：
1. 查询全部 GDP 相关指标：westock-data macro gdp,cpi_ppi,consumption,investment --year 2025
2. 解析 GDP 增速（实际 vs 名义）
3. 分析 CPI/PPI 价格走势（通胀/通缩信号）
4. 分析消费和投资数据（内需强弱）
5. 输出 GDP 多维度分析报告
```

### 场景 36：货币政策环境判断

```
用户："当前货币政策环境如何？"

AI 步骤：
1. 查询货币指标：westock-data macro financing,fundquantity,fundcost --year 2025
2. 分析社融规模（financing）→ 实体经济融资需求
3. 分析 M1/M2 增速（fundquantity）→ 货币供应宽松度
4. 分析利率水平（fundcost）→ 资金成本变化
5. 综合判断货币政策取向（宽松/中性/偏紧）
6. 输出货币政策环境分析
```

### 场景 37：宏观数据 + 市场联动分析

```
用户："PMI下滑对A股有什么影响？"

AI 步骤：
1. 查询 PMI 趋势：westock-data macro pmi --start 2024 --end 2025
2. 查询同期上证指数走势：westock-data quote sh000001
3. 对比 PMI 走势与指数走势的相关性
4. 分析 PMI 下行期间哪些板块受影响更大
5. 输出宏观-市场联动分析
```

---

## 八、板块成份股场景

### 场景 37b：查询概念股列表（⚠️ 常见易错场景）

```
用户："华为概念有哪些股票？"
用户："AI概念股有哪些？"
用户："新能源汽车概念股"

⚠️ 错误做法：用 search --sector（只返回板块名称，不含成份股）或用外部搜索工具
✅ 正确做法：用 sector --search 两步查询

AI 步骤：
1. 搜索概念板块代码：westock-data sector --search 华为
   → 返回匹配的板块列表（如 style_pt01801517 华为概念）
2. 用板块代码查成份股：westock-data sector style_pt01801517
   → 返回华为概念的全部成份股列表
3. 输出概念股列表（代码、名称）
4. 可选：批量查询行情 westock-data quote <代码列表> → 补充行情数据
```

> **关键区分**：
> - `search 华为 --sector`：只返回板块列表（名称+代码），用于查板块行情（quote/kline/minute）
> - `sector --search 华为`：搜索板块代码，再用 `sector <代码>` 查成份股

### 场景 38：查询行业成份股

```
用户："电子行业有哪些成份股？"

AI 步骤：
1. 查询申万一级电子行业成份股：westock-data sector sw1_pt01801080
2. 解析返回的成份股列表
3. 输出成份股列表（代码、名称）
4. 可补充成份股数量统计
```

### 场景 39：查询指数成份股

```
用户："沪深300有哪些成份股？"

AI 步骤：
1. 查询沪深300成份股：westock-data index sh000300
2. 解析返回的成份股列表
3. 输出成份股列表
4. 可按行业分布统计
```

### 场景 40：板块成份 + 行情联动分析

```
用户："帮我看看半导体板块的成份股，并查看涨幅前5的行情"

AI 步骤：
1. 查询申万二级半导体成份股：westock-data sector sw2_pt01801081
2. 取返回的成份股代码列表
3. 批量查询行情：westock-data quote <前N只代码逗号分隔>
4. 按涨跌幅排序取前5
5. 输出板块成份 + 涨幅排行分析
```

### 场景 40b：查询板块区间涨幅排行

```
用户："最近5日哪些行业涨幅最大？"

AI 步骤：
1. 查询申万一级行业涨幅排行：westock-data sector --rank interval_chg_rank_sw1 --sort chg5Days
2. 解析排行数据，按5日涨幅排序
3. 输出涨幅前10的行业名称和涨幅
4. 可补充分析：结合 market 命令查看具体行业走势
```

```
用户："各概念板块近一个月表现如何？"

AI 步骤：
1. 查询产业概念涨幅排行：westock-data sector --rank interval_chg_rank_industry --sort chg20Days
2. 解析排行数据
3. 输出涨幅前10和跌幅前10的概念板块
```

---

## 九、ETF 分析场景

### 场景 41：ETF 全景分析

```
用户："分析一下沪深300ETF的基本情况"

AI 步骤：
1. 搜索 ETF：westock-data search 沪深300ETF → sh510300
2. 查询 ETF 详情：westock-data etf sh510300
3. 解析基本信息：类别、成立日期、管理人、托管人、跟踪指数
4. 解析费用：认购费率、管理费率、托管费率、销售服务费
5. 解析净值/规模：单位净值、溢折率、规模、份额、净申购
6. 解析收益：今年以来、近1月/3月/6月/1年/3年收益率
7. 解析回撤：最大回撤指标
8. 输出 ETF 全景分析报告
```

### 场景 42：ETF 持仓分析

```
用户："沪深300ETF的重仓股有哪些？"

AI 步骤：
1. 搜索 ETF：westock-data search 沪深300ETF → sh510300
2. 查询 ETF 详情：westock-data etf sh510300
3. 解析 topStockChanges（重仓股票涨跌幅）→ 股票代码、名称、占比、涨跌幅、较上期变化
4. 解析 holdings（持仓明细）→ 完整持仓列表
5. 分析持仓集中度、行业分布、重仓股涨跌表现
6. 输出 ETF 持仓分析
```

### 场景 43：ETF 净值趋势分析

```
用户："沪深300ETF近一个月净值走势如何？"

AI 步骤：
1. 搜索 ETF：westock-data search 沪深300ETF → sh510300
2. 查询净值历史：westock-data etf-nav sh510300 --start 2026-02-10 --end 2026-03-10
3. 解析每日净值、涨跌幅
4. 计算区间收益率、最大回撤
5. 输出净值趋势分析
```

### 场景 44：ETF 费用对比

```
用户："对比沪深300ETF和创业板ETF的费用"

AI 步骤：
1. 搜索 ETF：westock-data search 沪深300ETF → sh510300
2. 搜索 ETF：westock-data search 创业板ETF → sz159915
3. 批量查询详情：westock-data etf sh510300,sz159915
4. 对比费用：认购费率、管理费率、托管费率、销售服务费
5. 对比规模、份额、流动性
6. 输出 ETF 费用对比分析
```

### 场景 45：ETF 溢折率分析

```
用户："分析一下沪深300ETF的溢折率情况"

AI 步骤：
1. 查询 ETF 详情：westock-data etf sh510300
2. 解析 disc（溢折率）、discountRatioCurve（溢折率曲线）、avgDiscountRatioCurve（同指数平均溢折率）
3. 判断溢价/折价程度及与同类 ETF 的对比
4. 输出溢折率分析
```

### 场景 46：公司回购查询

```
用户："查看小米最近的回购情况"

AI 步骤：
1. 搜索股票：westock-data search 小米集团 → hk01810
2. 查询回购数据：westock-data buyback hk01810
3. 解析回购明细：日期、回购股份、回购金额、回购均价
4. 计算累计回购金额、平均回购价格
5. 输出回购分析
```

---

**记住**：westock-data 是数据查询工具，AI 负责数据分析和洞察！
