---
name: steam-deep-analysis
description: |
  Steam平台专项深度分析。利用ext_json字段做游玩时长画像、放弃游戏分析、幻灭拐点、社区共识差评、退款玩家分析、改评追踪。
  触发词：Steam深度分析、游玩时长、放弃分析、幻灭拐点、社区共识、退款、改评、版本对比、ext_json
---

# Steam 深度分析

## 功能说明

利用 Steam 特有的 `ext_json` 字段和 `is_recommend` 字段，执行5种专项深度分析。

## 前置条件

- 目标游戏在 Steam 平台有数据（`channel_name = 'steam'`）
- ext_json 字段存在且有效

## ext_json 字段说明

| 字段 | 含义 | 备注 |
|------|------|------|
| `user_id` | Steam玩家ID | 可替代content_url提取的steam_id |
| `review_duration` | 写评论时的游玩时长（小时） | **优先使用** |
| `record_duration` | 总游玩时长（小时） | 备选 |
| `last2week_duration` | 过去两周游玩时长（分钟） | 判断是否活跃 |
| `last_play_time` | 最后一次游玩时间 | 判断是否放弃 |
| `helpful_num` | 觉得有用的人数 | 社区共识权重 |
| `funny_num` | 觉得有趣的人数 | — |
| `early_access` | 是否EA玩家 | 1=是 |
| `received_free` | 是否免费获得 | 1=是 |
| `refunded` | 是否退款 | 1=是 |
| `steam_purchase` | 是否Steam购买 | 1=是 |
| `unstarred` | 评论是否不算入总评分 | 1=不算(key激活/礼物) |
| `hardware` | 硬件信息 | 性能差评归因 |
| `steam_deck` | 是否Steam Deck | 1=是 |

### 提取方式
```sql
JSON_EXTRACT_SCALAR(ext_json, '$.review_duration') AS review_duration,
JSON_EXTRACT_SCALAR(ext_json, '$.helpful_num') AS helpful_num,
JSON_EXTRACT_SCALAR(ext_json, '$.refunded') AS refunded,
JSON_EXTRACT_SCALAR(ext_json, '$.user_id') AS steam_user_id
```

## 分析模板

### 模板一：游玩时长画像

**目的**：哪个阶段玩家差评多？好评玩家的爽感来源？

**自适应分段规则**：
1. 先查该游戏 review_duration 的 P25/P50/P75/P90 分位数
2. 据此动态划分分段（而非硬编码）
3. 报告中必须明确告知使用了什么分段及理由

**数据取用优先级**：`review_duration` > `record_duration` > 跳过该条

**输出**：各分段 × is_recommend 交叉分析 → 差评集中阶段 + 好评爽感阶段

### 模板二：放弃游戏分析

**方法B（优先使用，数据更多）**：
- 条件：`record_duration - review_duration <= 2小时`
- 含义：写完评论后基本就离开了游戏

**辅助字段**：
- `helpful_num` / `funny_num`：高赞差评 = 沉默多数的代言
- `received_free` / `refunded`：标记特殊用户群体

### 模板三：幻灭拐点（V-curve）

**方法**：
- X轴 = review_duration 细粒度分段（0-2/2-5/5-10/10-20/20-50/50-100/100-150/150-200/200-300/300-500/500-800/800+）
- Y轴 = 该分段的 is_recommend 好评率
- 找到好评率突然下降的拐点 → "幻灭阶段"
- 结合该阶段差评内容 → 诊断原因

### 模板四：社区共识差评（helpful加权）

**方法**：
- 筛选 `is_recommend=0` + `helpful_num >= 5`
- 按 helpful_num 排序 → 社区最认同的批评
- 分话题归纳 → 3-5个话题，每话题1-2个最高helpful例子

### 模板五：退款玩家分析

**方法**：
- 筛选 `refunded=1`
- 分析：评论内容、review_duration、is_recommend
- 与非退款差评对比 → 区分"可忍受的不满" vs "直接劝退硬伤"

## 改评追踪（Steam Review Change）

### 4步法
1. **版本后评论用户**：筛选 `comment_time >= 版本发布日`，通过 `REGEXP_EXTRACT(content_url, r'profiles/(\d+)')` 提取 steam_id
2. **版本前评论用户**：同一 steam_id 在版本前的评论
3. **用户分类**：LEFT JOIN → 有历史="老玩家"，无历史="新评论者"
4. **态度变化**：对比 `is_recommend` → "好评→差评" / "差评→好评" / "未变"

### 注意
- **仅适用于Steam**：其他平台无可追踪用户ID
- JOIN 条件：`steam_id + unified_edition_id`
- 大量数据时先 COUNT 确认匹配率

## 参考资料

- ext_json 完整字段文档：@references/ext-json-fields.md
