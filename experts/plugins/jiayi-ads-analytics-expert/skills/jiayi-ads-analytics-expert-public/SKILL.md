---
name: jiayi-ads-analytics-expert-public
description: 全媒体广告分析专家技能（公共版）。支持百度/360/腾讯/Google/Bing五平台，引导式MCP安装配置，自动生成含关键词、创意、素材分析的结构化日报。
description_zh: 全媒体广告分析专家（公共版）
description_en: Multi-platform Ads Analytics Expert (Public)
disable: false
agent_created: true
---

# 全媒体广告分析专家（公共版）

## When to use

当用户提出以下意图时触发：
- "帮我出日报" / "看看昨天投放数据" / "广告日报"
- "看下今天/昨天的展点消" / "各渠道数据怎么样"
- "投放分析" / "每日投放复盘"
- 任何涉及多平台广告数据汇总分析的请求

## 首次使用检查（Onboarding）

每次执行日报前，先检查环境是否就绪：
1. 检查 ~/.workbuddy/mcp.json 中是否有对应平台的MCP配置
2. 对每个已配置的MCP，调用验证接口确认token有效
3. 如果某平台未配置或token失效，引导用户完成配置/刷新
4. 通过MCP的list_accounts/get_account_info等接口动态获取用户账户列表
5. 不硬编码任何账户ID——所有账户信息从API运行时获取

## 报告结构

### Sheet 1：投放总览 & Highlight

**1.1 核心指标大盘**
- 全渠道日总消费 / 总展现 / 总点击 / 总转化 / 总 CPA
- 日环比（与前一天对比，标注↑↓和百分比变化）
- 周同比（与上周同天对比）

**1.2 分类汇总**

| 分类维度 | 内容 |
|---------|------|
| 按广告类型 | SEM搜索 vs 信息流展示，各自消费/转化/CPA占比 |
| 按媒体平台 | 百度/360/腾讯/Google/Bing 各自表现 |

**1.3 Highlight 总结**（3-5条，一句话+数据）
```
🟢 好的：[结论] — [数据支撑]
🔴 差的：[问题] — [数据] — [影响]
🟡 关注：[观察点] — [数据]
```

**1.4 现状与问题诊断**（2-4条核心问题，每条含数据证据和影响评估）

**1.5 历史问题追踪**（从ad-report-tracker.json读取，展示到期/过期/已解决事项）
- 🔴 已过期未解决 → 升级为P0
- 🟡 今日到期 → 用当日数据给出结论
- 🟢 观察中 → 简要标注当前状态
- ✅ 近3天已解决 → 一行带过

**1.6 今日 TODO**（3-5条，按优先级排列，含追踪到期升级的P0）
```
P0（立即处理）：[具体操作] — [原因] — [预期效果]
P1（今日完成）：...
P2（本周跟进）：...
```

### Sheet 2：搜索广告 (SEM) 明细

**结构原则：总→分（先全渠道汇总→再按渠道分账户→每个账户按统一维度展开），每个渠道的分析维度必须一致。**

**SEM完整分析维度（缺一不可）：**
- 账户×出价方式维度
- 词性维度（品牌/通用/场景/竞品）
- 计划明细
- 关键词明细（含匹配模式分析）
- **创意效果维度（标题/描述的CTR对比）**
- Highlight + 问题 + TODO（具体到词+创意+匹配+出价）

**2.1 SEM全渠道汇总表**

| 渠道 | 账户 | 出价方式 | 消费 | 展现 | 点击 | CTR | CPC | 转化 | CPA | 日环比消费 | 日环比CPA |
|------|------|---------|------|------|------|-----|-----|------|-----|----------|----------|
| 百度 | 账户A | CPC | ... | | | | | | | | |
| 百度 | 账户B | CPC+OCPC | ... | | | | | | | | |
| 百度 | 账户C | OCPC | ... | | | | | | | | |
| 360 | 账户D | CPC | ... | | | | | | | | |
| 360 | 账户E | OCPC | ... | | | | | | | | |
| 360 | 账户F | — | ... | | | | | | | | |
| Google | 账户G | CPC | ... | | | | | | | | |
| Bing | 账户H | CPC | ... | | | | | | | | |
| 腾讯 | 账户I | OCPC | ... | | | | | | | | |
| **SEM合计** | | | | | | | | | | | |

> 注：以上账户为示例占位符，实际运行时通过MCP/API动态获取用户已配置的账户列表。

**重要：转化数据获取规则**
- 百度：所有账户（含CPC）都有转化数据（ocpcConversionsDetail25+3）
- 360 CPC：从 /dianjing/report/keyword 的 converts 字段获取（CPC账户也能看转化！）
- 360 OCPC：从 /dianjing/report/Ocpc 获取
- Google/Bing/搜狗：API直接返回 conversions

**2.2 分词性汇总（跨渠道统一维度）**

将所有渠道的计划按词性分类（品牌词/通用词/场景词/竞品词），横向对比：

| 词性 | 消费 | 占比 | 点击 | 转化 | CPA | vs前日CPA | 效率评估 |
|------|------|------|------|------|-----|----------|---------|
| 品牌词 | ¥xxx | xx% | | | | | 核心护城河 |
| 通用词 | ¥xxx | xx% | | | | | 主要拉新 |
| 场景词 | ¥xxx | xx% | | | | | 精准场景 |
| 竞品词 | ¥xxx | xx% | | | | | 截流 |

**2.3 各渠道计划明细（统一格式，按渠道分块展示）**

每个渠道一个子表格，列固定为：

| 计划名 | 词性 | 出价方式 | 消费 | 展现 | 点击 | CTR | CPC | 转化 | CPA | 日环比CPA | 标记 |
|--------|------|---------|------|------|------|-----|-----|------|-----|----------|------|

标记规则：🟢CPA<均值且有量 / 🔴CPA>均值2倍或零转化 / 🟡待观察

按消费降序排列，每渠道Top10。

**2.4 关键词/检索词 Top20（跨渠道合并排序）**

将所有渠道的关键词按消费合并排序：

| 关键词 | 渠道 | 计划 | 匹配模式 | 消费 | 点击 | CTR | CPC | 转化 | CPA | 操作建议 |
|--------|------|------|---------|------|------|-----|-----|------|-----|---------|

操作建议列必须具体到操作层面（不能空泛），例如：
- "暂停（¥1,154花费仅0.5转化）"
- "出价+20%（CPA远低于均值，放量空间大）"
- "改精确匹配（当前智能匹配CTR仅1.4%）"
- "加否词'免费'（检索词分析发现大量无效流量）"

**2.5 创意效果分析**

**创意数据获取方式（已验证可用）：**
- 百度：`reportType=12, levelOfDetails=7`（返回name数组: [账户,计划,单元,标题,描述1,描述2]）
- Google：GAQL查 `ad_group_ad` 资源，含 `ad_group_ad.ad.responsive_search_ad.headlines` + metrics
- 360：`POST /dianjing/report/creative`（form-urlencoded，返回 title/clicks/views/totalCost 等）
- Bing：MCP `get_ads(ad_group_id)` 逐广告组查

按渠道展示创意标题/描述的效果对比（同计划内不同创意的CTR、转化率差异）：

| 渠道 | 计划 | 创意标题(摘要) | 展现 | 点击 | CTR | 转化 | 转化率 | 评价 |
|------|------|--------------|------|------|-----|------|--------|------|

分析维度：
- **同计划内多条创意的CTR对比**：哪条标题吸引点击更多
- **转化率差异**：CTR高不代表转化好，要看点击后的转化率
- **创意方向归类**：功能卖点型 vs 场景痛点型 vs 数据佐证型 vs 竞品对比型
- **建议**：具体到"XX计划的创意A(CTR 5.2%)优于创意B(CTR 2.1%)，建议暂停B保留A，新增C方向测试"

**2.6 匹配模式效率分析**

| 匹配模式 | 消费 | 占比 | 点击 | CTR | CPC | 转化 | CPA | 效率对比 |
|---------|------|------|------|-----|-----|------|-----|---------|
| 精确 | | | | | | | | |
| 短语 | | | | | | | | |
| 智能/广泛 | | | | | | | | |

给出匹配模式优化建议：哪些词应从智能改精确（流量大但转化差），哪些词可从精确改短语（量太小需放量）。

**2.7 SEM Highlight & 问题诊断 & TODO**

```
━━━ 🟢 表现好的（继续保持/加量）━━━
具体到：[渠道]-[账户]-[计划]-[关键词]-[匹配模式]-[创意方向] → 数据 → 建议操作
例：百度「品牌词X」精确匹配 CPA低/日转化高 → 建议出价+15%争取更多展现份额
例：Google「品牌词X」精确匹配 创意"XXX" CTR高 → 优质创意,其他计划可复用此标题方向

━━━ 🔴 表现差的（需立即处理）━━━
具体到：[渠道]-[账户]-[计划]-[关键词/创意] → 数据 → 具体操作
例：Google「竞品词Y」短语匹配 消费高/低转化/CPA极高 → 立即暂停此词
例：百度 AI场景计划 创意B "XXX" CTR极低 → 暂停此创意,换功能卖点方向

━━━ 🟡 需关注（观察中）━━━
具体到对象+阈值+观察期限
例：360 OCPC CPA超出锁价14% → 观察3天，若持续超出则联系媒体调整

━━━ 📌 SEM TODO ━━━
P0: [具体操作] — 哪个平台/账户/计划/词/创意 — 怎么操作 — 预期效果
P1: ...
P2: ...
```

### Sheet 3：信息流 & 展示广告明细

**结构原则：同样总→分，统一维度。**

**信息流完整分析维度（缺一不可）：**
- 渠道×账户维度
- 广告组明细（素材方向+定向+出价）
- **素材效率矩阵（素材类型×定向方式交叉）**
- **素材创意对比（具体到创意标题/图片/视频的效果差异）**
- **定向人群效率对比**
- **落地页转化率对比**（如有数据）
- **投放时段效率**（如有数据）
- Highlight + 问题 + TODO（具体到广告组+素材+定向+出价的操作建议）

**3.1 信息流全渠道汇总表**

| 渠道 | 账户 | 出价方式 | 消费 | 展现 | 点击 | CTR | CPC/CPM | 转化 | CPA | 日环比消费 | 日环比CPA |
|------|------|---------|------|------|------|-----|---------|------|-----|----------|----------|
| 腾讯 | 账户J | OCPM+OCPC | | | | | | | | | |
| 360展示 | 账户K | 屏保/弹窗 | | | | | | | | | |
| 360展示 | 账户L | 屏保/弹窗 | | | | | | | | | |
| **信息流合计** | | | | | | | | | | | |

> 注：以上账户为示例占位符，实际运行时通过MCP/API动态获取用户已配置的账户列表。

**3.2 广告组/素材明细（统一格式）**

| 广告组名 | 素材类型 | 素材方向 | 定向方式 | 出价方式 | 消费 | 展现 | 点击 | CTR | 转化 | CPA | 日环比CPA | 标记 |
|---------|---------|---------|---------|---------|------|------|------|-----|------|-----|----------|------|

字段提取规则（从广告组命名规范中解析）：
- 素材类型：图文/横版视频/竖版视频/应用下载
- 素材方向：根据用户命名规范解析
- 定向方式：通投/排联盟-排已转化/自定义人群等
- 出价方式：OCPM/OCPC

按消费降序，标记规则同SEM。

**3.3 素材效率矩阵（按素材类型×定向方式交叉分析）**

| 素材类型\定向 | 通投(OCPM) | 排联盟(OCPM) | 通投(OCPC) | 排联盟(OCPC) |
|-------------|-----------|------------|-----------|------------|
| 图文-方向A | CPA¥xx/转化xx | CPA¥xx/转化xx | | |
| 横版视频-方向B | | | CPA¥xx/转化xx | |
| 横版视频-方向C | | | CPA¥xx/转化xx | CPA¥xx/转化xx |
| 应用-方向D | CPA¥xx/转化xx | | | CPA¥xx/转化xx |

标注每个格子的CPA和转化数，方便一眼看出哪个"素材×定向"组合最优。

**3.4 创意素材效果对比**

| 素材/创意名 | 广告组 | 类型 | 展现 | 点击 | CTR | 转化 | CVR(转化率) | CPA | 评价 |
|------------|--------|------|------|------|-----|------|-----------|-----|------|

分析维度：
- **同方向不同素材的CTR对比**：哪个创意/视频的点击率更高
- **CTR vs CVR的关系**：高CTR不代表高转化，要看完整漏斗
- **创意疲劳度**：CTR是否在持续下降（对比近3天趋势）
- **建议**：具体到"XX素材CTR下降疑似疲劳，建议更换；YY方向CTR+CVR双高，建议追加预算+复制类似素材"

**素材图片获取方式：**
- 腾讯广告：`dynamic_creatives/get`(filtering by adgroup_id) → 取 creative_components.image[].value.image_id → `images/get`(filtering by image_id, fields含thumb_preview_url) → **用 thumb_preview_url（CDN链接，公开可访问）**
  - preview_url 是 api.e.qq.com 域名需要token才能访问，**日报里必须用 thumb_preview_url**
- 360展示：`/display/report/cost` 直接返回 materialUrls 字段（CDN链接，公开可访问）
- 搜索广告（百度/Google/360搜索/Bing）：纯文字创意，无图片

**日报中的图片展示规则：**
- 信息流/展示广告Sheet中，Top消费素材需展示缩略图（<img src="url" width="120">）
- 按消费降序展示Top10素材，每个素材含：缩略图 + 创意名 + 消费 + 点击 + CTR + 转化 + CPA
- 用于直观对比哪个视觉素材效果好/差

**3.5 定向人群效率对比**

| 定向方式 | 消费 | 展现 | 转化 | CPA | CPM | 人群质量评估 |
|---------|------|------|------|-----|-----|------------|
| 通投 | | | | | | |
| 排联盟-排已转化 | | | | | | |
| 其他定向 | | | | | | |

**3.6 信息流 Highlight & 问题诊断 & TODO**

```
━━━ 🟢 优质组合（加预算/扩展）━━━
具体到：[广告组名] → 素材类型+定向+出价 → 数据 → 建议
例：「方向A(通投OCPM)」CPA低/有量 → 预算+50%，同时复制此方向新建横版视频素材测试

━━━ 🔴 低效组合（降预算/暂停/换素材）━━━
具体到：[广告组名] → 问题 → 具体操作
例：「方向B(OCPC)」CPA飙升仅少量转化 → 暂停此组，将预算转移给CPA低的组
例：360展示「XX人群-屏保」CTR极低 → 创意疲劳，建议更换素材

━━━ 🟡 素材/定向策略建议 ━━━
基于矩阵+创意+定向分析综合给出：
- 最优组合：[素材类型] × [定向] × [出价] 的胜出公式
- 应扩展：哪类素材方向+哪种定向正在起量
- 应收缩：哪类持续低效
- 新测试方向：基于现有数据推断可能有效的新组合（素材方向+定向+出价方式）
- 创意迭代：哪些素材需要更新（CTR下降/疲劳）

━━━ 📌 信息流 TODO ━━━
P0: [具体操作] — 哪个广告组/素材 — 怎么操作（调预算/换素材/改定向/调出价/新建测试组）— 预期效果
P1: ...
P2: ...
```

### Sheet 4：近7日新增动作效果追踪

本模块专门追踪**最近7天内新增的投放动作**（加词、加创意、改匹配、加素材、新计划上线等），评估其效果，给出"有没有用"的结论和后续优化建议。

**4.1 新增动作识别**

通过以下方式识别近7日新增：
- 搜索广告：对比最近7天 vs 之前7天的关键词/计划/创意列表，新出现的即为"新增"
- 信息流：近7天内首次有消费记录的广告组/素材
- 也可由用户手动告知"我昨天加了XX"

**4.2 新增关键词效果**

| 新增词 | 所属计划 | 上线天数 | 消费 | 点击 | 转化 | CPA | vs 同计划均值 | 结论 |
|--------|---------|---------|------|------|------|-----|-------------|------|
| xxx | ... | 3天 | ¥xx | xx | x | ¥xx | CPA高30% | 🔴 效果差，建议降价 |

结论标记：
- ✅ 有效：CPA ≤ 同计划均值，且有转化
- ⚠️ 待观察：上线≤2天，数据量不足以判断（消费<¥100 或 点击<30）
- 🔴 无效：CPA > 同计划均值 50% 以上，或花费>¥200 仍无转化

**4.3 新增创意/素材效果**

| 新素材 | 计划/广告组 | 上线天数 | 展现 | 点击 | CTR | 消费 | 转化 | CPA | vs 老素材 | 结论 |
|--------|-----------|---------|------|------|-----|------|------|-----|----------|------|

结论标记：
- ✅ 跑赢老素材：CTR 或 CPA 优于同组老素材均值
- ⚠️ 持平/待观察：差异<10%，或数据量不够
- 🔴 跑输老素材：CPA 高于老素材 30%+ 或 CTR 低于老素材 50%+

**4.4 匹配模式/出价调整效果**

| 调整内容 | 调整前(近7日均值) | 调整后 | 变化 | 结论 |
|---------|-----------------|--------|------|------|
| XX词改精确→智能 | CPC¥3/CTR 5% | CPC¥4/CTR 8% | CTR↑60% CPC↑33% | ⚠️ 流量增但成本升，观察CPA |
| XX计划出价+20% | 日消¥500/CPA¥20 | 日消¥800/CPA¥22 | 量↑60% CPA↑10% | ✅ 有效放量 |

**4.5 新增动作总结 & 建议**

```
✅ 有效动作（继续保持/加强）：
  - [具体动作] → [效果数据] → [下一步建议]

🔴 无效动作（需要调整/停止）：
  - [具体动作] → [效果数据] → [建议操作]

⚠️ 待观察（数据不足，继续跑2-3天再判断）：
  - [具体动作] → [当前数据] → [判断标准：达到XX则保留，否则停止]
```

**判断"有没有用"的标准：**
1. 新词/新素材：CPA ≤ 同计划/同组历史均值 → 有用
2. 匹配调整：CTR 提升且 CPA 未恶化 → 有用
3. 出价调整：量级提升且 CPA 涨幅 ≤ 10% → 有用
4. 花费 > ¥200 且 0 转化 → 确认无效，建议立即暂停
5. 上线 ≤ 2 天且消费 < ¥100 → 数据不足，标"待观察"

## 核心指标定义

| 指标 | 公式 | 说明 |
|------|------|------|
| 消费 | API直接返回 | 单位：¥（Google用汇率7.2折算） |
| 展现 | impression | 广告被展示次数 |
| 点击 | click | 被点击次数 |
| CTR | 点击/展现 | 点击率 |
| CPC | 消费/点击 | 单次点击成本 |
| CPM | 消费/展现×1000 | 千次展现成本 |
| 转化数 | 注册+表单（百度）/ converts（360）/ conversions（腾讯/Google/Bing） | 转化事件数 |
| CPA | 消费/转化数 | 单次转化成本 |
| 日环比 | (今日值-昨日值)/昨日值 | 成本类↑为恶化(红)↓为改善(绿)；量类↑为增长(绿)↓为下滑(红) |

## 数据拉取方式

### 百度搜索
- API: `POST https://api.baidu.com/json/sms/service/ReportService/getRealTimeData`
- 认证: JSON body header 里放 `accessToken` + `userName`（驼峰，传accounts.json里的name字段即可，任意非空字符串即可）
- **body字段名必须用 `realTimeRequestType`（不是reportRequestType！用错会报81012）**
- 必须加 `unitOfTime: 5, statRange: 2`
- 账户级: `reportType=2, levelOfDetails=2`
- 计划级: `reportType=5, levelOfDetails=3`
- 关键词级: `reportType=14, levelOfDetails=11`
- **创意级: `reportType=12, levelOfDetails=7`**（返回name: [账户,计划,单元,标题,描述1,描述2]）
- **转化字段**: `ocpcConversionsDetail25`（应用注册）+ `ocpcConversionsDetail3`（表单提交）
- `conversion` 字段总返回0，必须用 ocpcConversionsDetail 系列
- performanceData 必须含 `impression` 和 `click`（必填）
- Token刷新: 用 refresh-tokens 脚本（URL: https://u.baidu.com/oauth/refreshToken）
- 账户列表: 从 accounts.json 动态读取用户已配置的百度账户列表

### 360搜索
- 登录: `POST https://api.e.360.cn/account/clientLogin`（header: apiKey, body: username+passwd）
- 密码加密: MD5→hex字符串(UTF-8,32字节)→AES-CBC(key=apiSecret前16,IV=后16,无padding)→64位hex
- **所有POST请求必须用 Content-Type: application/x-www-form-urlencoded（不是JSON！）**
- Token文件: 从MCP配置的token存储路径读取
- 搜索计划消耗: `POST /dianjing/report/campaign` (form-urlencoded: startDate=YYYY-MM-DD&endDate=YYYY-MM-DD)
- **搜索转化数据（campaign接口不返回转化！必须额外调以下接口）**:
  - OCPC转化: `POST /dianjing/report/Ocpc`（只有OCPC账户有，T+1，字段: converts/factConverts/ocpcCpa/totalCost）
  - CPC关键词转化: `POST /dianjing/report/keyword`（字段含 converts/convertsCost）
  - 展示广告转化: `POST /display/report/adtransform`（返回 count + transform数组明细）
- **搜索创意报表: `POST /dianjing/report/creative`**（返回 creativeId/title/clicks/views/totalCost 等）
- 展示广告消耗: `POST /display/report/cost`
- 账户列表: 从 accounts.json 动态读取用户已配置的360账户列表（搜索+展示）

### 腾讯广告
- API: `GET https://api.e.qq.com/v3.0/daily_reports/get`
- Token: 从MCP配置的环境变量读取（支持多组token对应不同子客账户）
- 展示互选子客: level=REPORT_LEVEL_ADGROUP, group_by=['adgroup_id']
- 搜索推广子客: level=REPORT_LEVEL_ADVERTISER_TOTAL, group_by=['date']（必须加group_by）
- 转化字段: `conversions_count`
- CPA 需自算: cost/conversions_count（API 不直接返回 conversion_cost）
- 费用单位: **分**（需÷100转元）
- 账户列表: 从MCP配置的环境变量动态获取account_id

### Google Ads
- 用 GAQL 查询 v20 API
- URL: `https://googleads.googleapis.com/v20/customers/{customer_id}/googleAds:search`
- Header: Authorization + developer-token + login-customer-id（如果有MCC管理账号，必须在header中加 login-customer-id=MCC的Customer ID）
- 指标: metrics.cost_micros(÷1e6=USD), metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions, metrics.cost_per_conversion
- 汇率: USD×7.2=CNY
- 账户信息: 从MCP配置的环境变量读取 customer_id、developer-token 等

### Bing Ads
- 用 Python bingads SDK + ReportingServiceManager
- Account ID / Customer ID: 从MCP配置的环境变量读取
- `report.Scope.AccountIds.long = [account_id]`, `Campaigns = None`
- **必须加 report.Aggregation = 'Daily'**（否则报 ReportAggregation 枚举错误）
- 报表提交后自动轮询下载 CSV
- 列: TimePeriod, CampaignName, Impressions, Clicks, Ctr, AverageCpc, Spend, Conversions, CostPerConversion
- MCP get_campaigns需传多类型: 'Search DynamicSearchAds Shopping Audience PerformanceMax'

## 输出规则

1. **所有洞察必须有数据支撑**，不做空泛评价
2. **TODO 必须具体可执行**，包含"哪个账户/哪个计划/做什么操作/预期效果"
3. **成本类指标环比**：↑ 为恶化（红色）、↓ 为改善（绿色）
4. **效率/量级指标环比**：↑ 为增长（绿色）、↓ 为下滑（红色）
5. **日报风格**：简洁抓重点，不堆砌数据，每个洞察一句话
6. **默认中文输出**
7. 输出格式为 **HTML**（单文件，含内联CSS，深色主题，清晰易读），文件名：`{品牌名}_{YYYYMMDD}_广告日报.html`
8. HTML 设计要求：深色背景、表格紧凑、关键数据突出（大字/颜色标记）、移动端适配
9. 用 `preview_url` 工具展示给用户，同时用 `deliver_attachments` 交付文件
10. 如当日数据为空（如还没消费），标注"截至N点数据"或"暂无消费"

## Pitfalls

- 百度转化字段**不是** `conversion`，是 `ocpcConversionsDetail25` + `ocpcConversionsDetail3`
- 百度 `performanceData` 必须含 `impression` 和 `click`，否则报 invalid
- **百度 body 字段名必须是 `realTimeRequestType`**，不是 `reportRequestType`（后者报81012）
- **百度必须加 `unitOfTime: 5, statRange: 2`**
- 百度 userName 传 accounts.json 里的 name 字段（任意非空字符串即可）
- 百度 token 刷新 URL 是 `https://u.baidu.com/oauth/refreshToken`（不是api.baidu.com/oauth也不是iam.baidu.com）
- 腾讯广告费用单位是**分**不是元，要÷100
- 腾讯搜索推广子客需要用 `REPORT_LEVEL_ADVERTISER_TOTAL` + group_by=['date']，展示互选子客用 `REPORT_LEVEL_ADGROUP` + group_by=['adgroup_id']
- Google Ads API 需要 v20（v16-v18 已下线返回404）
- Google Ads 如果有MCC管理账号，必须在header中加 login-customer-id=MCC的Customer ID
- 360 OCPC 报表只有 T+1 结算数据（当天拉不到当天的转化）
- 360 展示广告 cost 接口当天数据 totalCost 可能为0（当天结算未完成），建议拉昨天
- 360 报告接口返回404时，通常是 token 过期——需重启 MCP 让360重新自动登录
- Bing 报表必须加 `report.Aggregation = 'Daily'`（否则枚举错误）
- Bing 报表是异步的，用 ReportingServiceManager 自动处理

## Verification

- 检查每个平台是否都有数据返回（非空）
- 交叉验证：总消费 = 各渠道消费之和
- CPA 计算验证：消费/转化 = 表中 CPA 值
- 环比方向验证：成本↑标红、量级↑标绿

## 配套定时任务（Automation）

使用本skill建议配置以下WorkBuddy自动化任务：

| 任务 | 频率 | 说明 |
|------|------|------|
| 百度营销Token自动刷新 | 每天9:00 | 运行 refresh-tokens 脚本 |
| 腾讯广告Token自动刷新 | 每天8:30 | 调用 oauth_refresh_token 刷新token |
| 每日广告投放日报 | 每天9:00/10:00 | 调用本skill生成昨日全平台日报 |

**Token刷新必须在日报生成之前执行**（百度/腾讯token 24h过期，日报拉数据需要有效token）。

创建方式：在WorkBuddy对话中直接说"帮我创建百度token每天9点自动刷新的定时任务"即可。

## 日报记忆与连续性追踪

### 机制说明
日报不是孤立的——每天的问题诊断、TODO建议、待观察事项必须形成**跨天追踪链**。上一份日报说的"观察3天再判断"、"本周跟进"的事项，到期后必须在新日报中给出结论。

### 追踪日志文件
- 路径：`{workspace}/.workbuddy/memory/ad-report-tracker.json`
- 格式：JSON数组，每条记录一个待追踪事项
- 每次出日报时**先读取**此文件，检查是否有到期/过期事项需要回顾

### 追踪记录结构
```json
{
  "id": "20260528-001",
  "created_date": "2026-05-28",
  "due_date": "2026-05-31",
  "category": "observe|action|warning",
  "priority": "P0|P1|P2",
  "platform": "百度|360|腾讯|Google|Bing|全渠道",
  "target": "具体计划/关键词/广告组名",
  "issue": "问题描述（一句话）",
  "threshold": "判断标准（如：CPA>60则暂停，CTR<1%则换素材）",
  "baseline_data": "记录时的基线数据（如：CPA=¥92, 转化4个）",
  "status": "open|resolved|escalated|expired",
  "resolution": "结束时填写结论"
}
```

### 每次出日报的追踪流程

**Step 1: 读取追踪日志**
- 读取 `ad-report-tracker.json`
- 筛选 status=open 的记录
- 按 due_date 排序，标记：🔴已过期(due_date < today) / 🟡今日到期 / 🟢未到期

**Step 2: 回顾已到期事项**
- 对每个已到期/今日到期的事项，用当日数据重新评估：
  - 达到threshold → 标记为 `escalated`，在日报TODO中升级为P0动作
  - 问题已消失/改善 → 标记为 `resolved`，在Highlight中标注🟢
  - 仍在观察区间内但没恶化 → 延期due_date +2天，保持open

**Step 3: 生成新的追踪项**
- 从当日日报的以下内容中提取新追踪项：
  - TODO中标注"观察X天"/"本周跟进"的事项
  - Sheet 4 中标记为"⚠️待观察"的新增动作
  - Highlight中标记🟡需关注的趋势
- 自动设置due_date = today + 观察天数（默认3天）

**Step 4: 写入追踪日志**
- 更新已有记录的status
- 追加新记录
- 保存到 ad-report-tracker.json

### 日报中的追踪展示

在HTML日报中新增一个固定模块（放在Highlight之后、TODO之前）：

**历史问题追踪**

```
🔴 已到期未解决（需立即处理）：
  [提出日期] 问题描述 → 当时数据 → 今日数据 → [结论+建议]

🟡 今日到期（需复查）：
  [提出日期] 问题描述 → 阈值判断标准 → 今日数据 → [达标/未达标]

🟢 观察中（未到期）：
  [提出日期] 问题描述 → 还有X天到期 → 当前状态

✅ 已解决（近3天内关闭的）：
  [提出日期→解决日期] 问题描述 ✓
```

### 追踪规则

1. **不漏追**：每个TODO中含时间限定词（"观察"/"跟进"/"X天后"/"本周"）的事项必须入追踪
2. **不忘提**：过期事项必须在日报中醒目展示，不能因为忘了就不提
3. **有结论**：到期事项必须给出明确结论（改善/恶化/不变），不能只说"继续观察"超过2次
4. **2次延期上限**：同一事项最多延期2次（共观察≤9天），超过必须升级为P0给出行动建议
5. **自动清理**：resolved状态的记录保留7天后从日志中移除，避免文件膨胀
