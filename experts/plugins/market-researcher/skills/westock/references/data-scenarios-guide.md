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
→ westock-data search 牧原股份 → westock-data kline sz002714 day 20 → 解析JSON提取volume → 计算统计指标 → 输出分析报告
```

### 场景 3：财务分析

```
用户："分析贵州茅台的盈利能力"
→ westock-data finance sh600519 summary → 提取关键指标 → 计算同比/环比 → 输出分析结论
```

### 场景 4：多股对比（使用批量查询）

```
用户："对比腾讯和阿里巴巴的市值"
→ westock-data quote hk00700,BABA.N → 一次查询两只股票 → 解析 BatchResult → 提取市值 → 输出对比
```

---

## 二、资金分析场景

### 场景 5：批量资金流向分析

```
用户："对比腾讯和美团的资金流向"
→ westock-data hkfund hk00700,hk03690 2026-03-10 → 一次查询两只 → 解析 BatchResult → 对比资金面
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

## 三、新闻资讯与研究场景

### 场景 8：新闻资讯查询

```
用户："查询贵州茅台最近的新闻"
→ westock-data news sh600519 1 20 2 → 解析新闻列表 → 展示标题和时间
```

### 场景 9：机构评级分析

```
用户："查看中芯国际的机构评级"
→ westock-data rating sh688981 → 解析买入/增持/中性/减持/卖出数量 → 输出评级分析
```

### 场景 10：批量机构评级对比

```
用户："对比浦发银行和招商银行的机构评级"
→ westock-data rating sh600000,sh600036 → 解析 BatchResult → 对比两只股票的评级分布 → 输出对比分析
```

---

## 四、指数与板块场景

### 场景 11：指数行情查询

```
用户："查一下今天大盘的涨跌情况"
→ westock-data search 上证指数 → 获取 sh000001 → westock-data market sh000001 → 展示涨跌幅和成交额
```

### 场景 12：多指数对比

```
用户："对比沪深两市今天的表现"
→ westock-data market sh000001,sz399001 → 解析 BatchResult → 对比涨跌幅 → 输出分析
```

### 场景 13：板块行情分析

```
用户："半导体板块近一个月的走势怎么样"
→ westock-data search 半导体 sector → 获取 pt01801081 → westock-data market pt01801081 2026-02-10 2026-03-10 → 解析历史数据 → 计算区间涨跌幅 → 输出趋势分析
```

### 场景 13.1：指数/板块资金流向分析

```
用户："上证指数今天的资金流向如何？"
→ westock-data market sh000001 → 解析 mainNetFlow/jumboNetFlow/blockNetFlow 等 → 输出主力资金净流入/流出分析

用户："半导体板块近一周的资金流向趋势"
→ westock-data search 半导体 sector → 获取 pt01801081
→ westock-data market pt01801081 2026-03-03 2026-03-10 → 解析每日 mainNetFlow/mainInFlow/mainOutFlow → 输出资金流向趋势
```

### 场景 14：跨市场指数对比

```
用户："对比恒生指数和纳斯达克最近的表现"

AI 步骤：
1. 批量查询历史行情：westock-data market hkHSI 2026-02-10 2026-03-10
2. 查询纳指历史：westock-data market us.IXIC 2026-02-10 2026-03-10
3. 分别解析各指数的历史数据
4. 对比区间涨跌幅和走势
5. 输出跨市场指数对比分析
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
5. 可选：查询热文排名：westock-data hot news 20
6. 直接基于格式化输出，综合输出市场热点概览
```

### 场景 16：浏览股单

```
用户："有什么好的选股策略推荐？"

AI 步骤：
1. 查询热门股单列表：westock-data watchlist rank
   → 格式化输出股单名称、ID、描述、持仓数、平均涨跌幅、关注人数、分页信息
2. 可选翻页：westock-data watchlist rank updateTime 20 --page 2
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
3. 逐日查询事件详情：westock-data calendar 2026-03-10 30
   → 格式化输出事件列表（按重要性排序），含星级、时间、国家、内容、前值/预测/实际值
4. 可按地区筛选：westock-data calendar 2026-03-10 30 1  // 仅中国
5. 可按指标筛选：westock-data calendar 2026-03-10 30 1 1  // 仅经济数据
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
4. 可选：指定查询天数：westock-data ipo hs 60
5. 直接基于格式化输出，输出新股申购机会分析
```

### 场景 20：公告全文查询

```
用户："查看贵州茅台最近的财务公告内容"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询公告列表：westock-data notice sh600519 1  // 类型1=财务报告
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
2. 查询历史筹码：westock-data chip sh600036 2026-02-10 2026-03-10
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
4. 分析持股集中度、机构/个人占比、持股变动趋势
5. 输出股东结构分析报告
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
用户："贵州茅台的股息率是多少？"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询分红指标：westock-data dividend sh600519
3. 解析 dividendRatioTTM（股息率TTM）、dividendPS（每股股利）、dividendPaidRatio（股利支付率）
4. 解析 pxmzbInfos（派现募资比）→ 累计派现/募资情况
5. 输出分红能力分析
```

### 场景 26：跨市场分红对比

```
用户："对比腾讯和苹果的股息率"

AI 步骤：
1. 批量查询分红指标：westock-data dividend hk00700,usAAPL
2. 解析 BatchResult 中各股票的 dividendRatioTTM 和 dividendTTM
3. 对比两只股票的股息回报率
4. 输出跨市场分红对比分析
```

### 场景 27：港股分红历史查询

```
用户："查看腾讯近几年的分红记录"

AI 步骤：
1. 查询分红历史：westock-data dividend history hk00700
2. 解析 plans[] 中的分红方案
3. 分析每年分红趋势（每股派息、合计派现、分红频次）
4. 输出分红历史趋势分析
```

### 场景 28：财报披露日查询

```
用户："茅台什么时候发财报？"

AI 步骤：
1. 搜索股票：westock-data search 贵州茅台 → sh600519
2. 查询财报披露日：westock-data earnings sh600519
3. 解析 items[] 中的披露日列表
4. 区分已披露（isPredicted=false）和预约披露（isPredicted=true）
5. 输出最近的财报披露日历
```

### 场景 29：分红除权日查询

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

**记住**：westock-data 是数据查询工具，AI 负责数据分析和洞察！
