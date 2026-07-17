# BigQuery 查询规则

## 铁律（必须遵守）

### 0. 评论数据表优先级（最重要）

| 优先级 | 表 | 说明 |
|--------|---|------|
| **1** | **`tencent-databrain-prod.tiderider.opinion_feeds`** | 清洗后数据（去除爬虫脏数据），优先使用 |
| 2 | `tencent-databrain-prod.opinion.feeds` | 原始数据，仅当 `tiderider.opinion_feeds` 无该游戏数据时使用 |

**逻辑**：`opinion.feeds` 含大量爬虫抓取错误的脏数据 → 针对不同业务清洗后得到 `tiderider.opinion_feeds` → 统计/查询优先用清洗表。

### 1. 分区过滤
评论表的分区字段是 `comment_time`，且 `require_partition_filter=TRUE`。
**所有查询必须包含 `comment_time BETWEEN` 或等效时间范围条件。**

### 2. 禁止全表扫描
- 不做 `SELECT *`
- 只做聚合查询
- 大数据量游戏（>30K/天）缩短时间窗口

### 3. 双字段搜索规则
| 关键词语言 | 搜索字段 | 原因 |
|-----------|---------|------|
| 英文 (greedy, monetization, crash...) | `content_to_zh` + `content_to_en` | 仅搜zh丢失90%+英文原文 |
| 中文 (氪金, 崩溃, 卡顿...) | `content_to_zh` | zh翻译覆盖率高 |

### 4. "greed" 类词特殊处理
- 使用 `REGEXP (?:^|[^a])greed` 排除 "agreed/disagreed" 子串
- 游戏专属名词（如PoE的Greed技能）需人工抽样核实

### 5. isvalid 过滤
- 默认 `isvalid >= 1`（排除纯水评）
- 业务名称叫"排除纯水评"，不要在报告中暴露字段名

### 6. 数据来源标注
- 报告中统一写：**「数据来源：TideRider数据库」**
- 不暴露底层表名 `opinion.feeds`
- 不暴露 GCP 项目名

## 常用字段说明

### 情感字段
- `sentiment_rating`：1(极负) / 2(负) / 3(中) / 4(正) / 5(极正)
- `is_recommend`：仅 Steam，1=好评 0=差评
- KPI定义：正面 = `sentiment_rating >= 4`，负面 = `sentiment_rating < 2`

### 帖子层级
- `comment_parent_id = '-1'`：主帖/发起讨论
- `comment_parent_id != '-1'`：回复

### 高讨论帖判定
- LEFT JOIN 后为空 + URL不含 `/threads/` → Discord频道，标注"讨论区"

## 清洗表优先级

当清洗表有数据时**必须优先使用**：

| 优先级 | 表 | 分区 | 过滤字段 | 用途 |
|--------|---|------|---------|------|
| ⭐ **1** | **`tiderider.anomaly_details`** | Start_Date | UID + Region | **异动归因（第一优先）** — 含完整归因+Remark四模块 |
| 2 | `tiderider.anomaly_flag_content` | Start_Date | UID + Region | 快速预览/补充（Flag+百分比） |
| 3 | `tiderider.daily_details` | Date | UID | 每日舆情概况 |
| 4 | `tiderider.key_document_collection_extra` | Start_Date | Game（名称非UID） | **关键事件**（版本更新/促销/社区事件） |
| 5 | `tiderider.all_games_with_tag_extra` | Date | Game（名称非UID） | 标签分类汇总 |

### ⭐ anomaly_details — 异动归因核心表

**何时查**：用户问异动/舆情波动/为什么情感下降或上升
**过滤**：`UID` + `Start_Date/End_Date` 与用户时间范围重叠
**按 Region 分别展示**：同一时间段可能有多条记录（不同区域），需分别呈现

**完整字段**：

| 字段组 | 字段 | 说明 |
|--------|------|------|
| 时间 | `Start_Date`, `End_Date` | 异动起止日期 |
| 标识 | `UID`, `Region` | 游戏UID + 区域(语言代码如ja/ko/en) |
| 概述 | `Overview`, `Overview_Title`, `Overview_Contribution` | 整体描述 + 主题 + 变化百分比 |
| 因素×6 | `Factor1~6_Name`, `Factor1~6_Contribution`, `Factor1~6_Detail` | 至少1个，最多6个，按贡献度排序 |
| **Remark** | JSON类型 | **⭐ 算法核心产出** — 每个Factor的四模块追踪 |
| 链接×6 | `Link1~6_Text`, `Link1~6_Url` | 背景事件参考链接 |

**Remark JSON 结构**（TideRider算法核心产出）：
```json
{
  "factors": [
    {
      "id": "Factor1",
      "typical_discussion": { "summary": "...", "raw_content": "...", "channel": "...", "url": "..." },
      "viral_post": { "summary": "...", "raw_content": "...", "channel": "...", "url": "..." },
      "hot_comment": { "summary": "...", "raw_content": "...", "channel": "...", "url": "..." },
      "kol": { "summary": "...", "raw_content": "...", "channel": "...", "url": "..." }
    }
  ]
}
```

四模块说明：
- **typical_discussion**（典型讨论）— 该话题下最有代表性的用户讨论
- **viral_post**（发酵主贴）— 扩散最广的原始帖子
- **hot_comment**（热门评论）— 互动最高的评论
- **kol**（关键KOL）— 影响力最大的发声者

**决策树**：
```
anomaly_details 有数据 → 直接输出（Overview + Factors + Remark四模块 + Links）
anomaly_details 无数据 → 退回 opinion.feeds 手动归因
```

### 关键事件表使用指引

`tiderider.key_document_collection_extra` 是了解**舆情波动上下文**的核心表，同时也是**舆情总结时的第一引用源**：

**定位**：官方公告/大V发布的内容 — 声量大、具有典型代表性

**使用场景**：
- **事件查询**：用户问"最近有什么事件？""为什么舆情波动？""版本更新情况？"
- **舆情总结/归纳**：优先引用该表内容作为主线观点

**过滤方式**：用 `Game` 字段（游戏英文名，如 "Path of Exile 2"），非 UID
**关键字段**：`Event_Name`（事件名称）、`Priority`（优先级1-5）、`Summary`（事件摘要）
**配合使用**：结合 anomaly_details 的异动数据，可以做"事件→舆情影响"的因果分析

### 舆情总结/归纳时的引用优先级

| 优先级 | 数据源 | 逻辑 |
|--------|--------|------|
| **1** | `key_document_collection_extra` | 官方/大V内容 — 声量大、代表性强 |
| **2** | `tiderider.opinion_feeds` / `opinion.feeds` 中高互动评论 | helpful/like/engagement高 = 社区共识 |

**总结方法**：先引用 key_document_collection_extra 的官方/大V内容作为主线观点 → 再用高互动评论作为玩家侧佐证

## 游戏专属查询规则

### DeltaForce（三角洲行动）— 默认排除国内渠道

DeltaForce 业务以**海外市场**为主，查询时默认排除中国国内渠道：

```sql
-- 默认排除的国内渠道（用户未明确指定渠道时自动添加）
AND channel_name NOT IN ('bilibili', 'taptap', 'hupu', 'tieba', 'weibo', 'douyin', 'xiaohongshu', 'zhihu', 'nga', 'colg', 'baidu', '3dm', 'gamersky', 'ali213')
```

**规则**：
- 用户未提及渠道 → 自动排除上述国内渠道
- 用户明确说"含国内"/"全渠道"/"包含B站" → 不排除
- 用户指定特定渠道（如"只看Steam"） → 按指定的来
- 此规则仅限 DeltaForce，其他游戏不受影响

---

## 舆情异动归因四模块

当 `anomaly_details` 有数据时，从 Remark JSON 中提取并展示每个 Factor 的四模块：

1. **典型讨论**（typical_discussion）— 代表性用户声音
2. **发酵主贴**（viral_post）— 传播最广的源头帖
3. **热门评论**（hot_comment）— 互动量最高的评论
4. **关键KOL**（kol）— 影响力最大的发声者

每个模块含：`summary`（摘要）、`raw_content`（原文）、`channel`（平台）、`url`（链接）

**决策树**：
- `anomaly_details` 有数据 → **第一优先**输出 Remark 四模块
- `anomaly_details` 无数据 → `anomaly_flag_content` 作为补充参考
- 两者都无 → 退回 `opinion.feeds` 手动归因
