# 数据源描述与限制说明

> 用途：查询失败或数据为空时，必须附带对应数据源的限制说明，让用户一次性理解原因。
> 每次返回查询结果时，也应在必要时标注数据来源及其局限。

---

## 数据源限制速查表

| Source Key | 名称 | 平台 | 关键限制 |
|------------|------|------|----------|
| `sensortower` | Sensor Tower | Mobile | KPI 数据有2天延迟；无法覆盖中国大陆 Google Play；第三方平台无数据 |
| `sensortower_overlap` | Sensortower App Overlap | Mobile | 月度粒度，约1个月延迟；无 global 汇总行，**未指定国家默认美国**；仅覆盖有一定体量的手游；overlap rate 为比例值（无绝对用户数）；iOS 和 Android 分别存储，跨平台合并为近似值 |
| `gamalytic` | Gamalytic | PC (Steam) | 仅 Steam 全球数据，不可按国家拆分；多平台游戏收入/销量可能偏低；PCU 从 2025-08 起有数据；月均 ACU 从 2015 起；日均 ACU 从 2023 起；愿望单从 2023-09 起 |
| `mscience` | M Science | PC/Console | 主要覆盖美国（高置信度）；部分游戏含英法德西数据（低置信度）；全球数据=五国加总（低置信度）；建议仅用美国数据 |
| `gsd` | Sparkers (GSD) | PC/Console | 主要覆盖欧洲市场及部分亚洲市场；部分游戏有美国数据；约1周延迟 |
| `ampere` | Ampere | PC/Console | 提供 PC/Console 的 DAU/MAU/留存/游戏时长；日/月粒度 |
| `npd` | NPD | PC/Console | 仅美国市场；仅月度数据；仅实体销售数据 |
| `calibration` | DataBrain Calibration | PC/Console | 校准后的收入/销量，置信度高，**必须在答案中标注 calibration_method**。详见 [databrain-calibration.md](databrain-calibration.md) |
| `integrated` / `estimated` / `databrain` | DataBrain Integrated | PC/Console | 预估值（融合第三方源），**仅供趋势参考，不可作为权威数字**。如有 estimated+calibration 混合行需分开说明。详见 [pconsole-integrated-tables.md](pconsole-integrated-tables.md) |
| `vginsights` | VG Insights | PC | **DEPRECATED** — 已停用，不可查询 |
| `appannie` | AppAnnie | Mobile | **DEPRECATED** — 已停用，不可查询 |
| `steam_overlap` | DataBrain Steam Overlap | PC | 抽样爬取300万 Steam 用户样本；仅含 PCU>1000 的游戏；每周更新 |
| `streamhatchet` | Stream Hatchet | Streaming | Twitch / YouTube Gaming / Facebook Gaming 直播数据 |
| `newzoo` | Newzoo | PC/Console | 已于 2023-03-01 停止更新，历史数据可查 |

---

## 详细数据源描述

### Sensor Tower (sensortower)
- **平台**: Mobile (iOS + Android)
- **KPI 数据有 2 天延迟**
- **无法覆盖中国大陆区的 Google Play**
- **所有国家除 iOS 和 Google Play 外的第三方平台无数据**
- 小国/地区 DAU 通常为 NULL（仅 global / cn / us / jp / kr 等大市场有 DAU）
- `market` 字段为小写 ISO-2 code
- **中国独占/小体量游戏常无数据**：如 "随变游戏" 等中国独占、小体量标题可能在 `daily_uid` 与 `monthly_uid` 中都为空行。当 `common.app_detail` 能查到合法 `unified_id` 但所有 metric 查询返回 0 行时，及早反馈数据缺失，不要无限重试

### Gamalytic
- **平台**: PC (Steam only)
- **仅全球数据，不可按国家拆分**
- 多平台发行的游戏，Steam 端收入/销量可能低于真实总值
- Revenue 和 units sold **包含**预购数据
- **PCU** 数据从 **2025年8月** 起可用
- **月均 ACU** 数据从 **2015年** 起可用
- **日均 ACU** 数据从 **2023年** 起可用
- **愿望单估算** 数据从 **2023年9月** 起可用（部分游戏从 2024-07 才有非 NULL 值）
- 无 `entity_name` 列，需 JOIN `common.app_detail`

### M Science (mscience)
- **平台**: PC/Console
- **主要覆盖美国数据（高置信度）**
- 部分游戏含欧洲四国（英法德西）数据，**欧洲数据置信度较低**
- 全球数据 = 五国加总数据，**置信度低**
- **建议前往 DataBrain 平台筛选仅美国数据用于参考**
- **必须**在回答中说明数据的范围和国家限制
- 常用 `app_id` 作为 key，需要先通过 `common.unified_ids` 映射

### Sparkers / GSD
- **平台**: PC/Console
- 数据由主要发行商直接共享给 GSD
- **主要覆盖欧洲市场**，部分亚洲市场，部分游戏有美国数据
- 数据延迟约 1 周
- 含实体 + 数字版销量/收入

### Ampere
- **平台**: PC/Console
- 提供 active users (DAU/MAU)、留存 (bounded/unbounded)、游戏时长
- 日粒度 + 月粒度
- 含分国家、分平台、分设备维度

### NPD
- **平台**: PC/Console
- **仅美国市场**
- **仅月度数据**
- 提供实体销售数据

### DataBrain Calibration (calibration)
- **Platform**: PC / Console
- **Authoritative single-source revenue / units** — calibrated against official partner data + third-party cumulative curves. Highest confidence among DataBrain-derived numbers.
- **Answer-labelling rule**: always tag the number as **"DataBrain Calibration"** and surface the specific **`calibration_method`** value (one auto-selected method per game).
- **Coverage caveat**: `market='global'` + 60+ country codes are populated (unlike Gamalytic which is global-only) — country breakdowns are answerable here.
- Schema, method priority table, dimension matrix, query patterns → [databrain-calibration.md](databrain-calibration.md).

### DataBrain Integrated (integrated / estimated / databrain)
- **Platform**: PC / Console
- Derived by **fusing third-party sources** with platform-share ratios and per-country player-distribution weights — purely an **estimate**.
- **Answer-labelling rule**: report as **"trend-only estimate, not ground-truth"**. If the user wants serious external numbers, redirect to DataBrain Calibration above (revenue / units) or the raw single-source table for that vendor.
- Combined source-key values `estimated` / `databrain` may carry a mix of estimated + calibrated rows in some upstream APIs — when that happens, **separate the two in the answer**.
- Schema, source-prefix coverage matrix, freshness per source (gamalytic T-0 / ampere T-12 / mscience T-5 / streamhatchet T-1), abandoned columns, `(platform, segment, market)` filter templates, query patterns → [pconsole-integrated-tables.md](pconsole-integrated-tables.md).

### Sensortower App Overlap (sensortower_overlap)
- **平台**: Mobile (iOS + Android)
- **月度粒度**，`start_date` 为每月第一天（DATETIME 类型），约有 1 个月延迟
- **无 `global` market 汇总行**：不能 `WHERE market = 'global'`，会返回 0 行；**用户未指定国家时默认使用 `market = 'us'`**，并在答案中注明"以美国市场为例"
- 仅覆盖有一定体量的手游，冷门游戏可能无数据
- `overlap rate` 为比例值（0–1），**无绝对重叠用户数**
- iOS 和 Android 分别存储（同一游戏对同一市场有两行），跨平台合并需加权平均，简单平均为近似值
- 两个核心指标：`app_a_users_using_app_b_share`（overlap rate）和 `app_a_users_likelihood_multiplier`（affinity score）
- 双向存储：`(A→B)` 和 `(B→A)` 均有行，但语义不同，不可混用
- 完整文档 → [`sensortower-overlap.md`](sensortower-overlap.md)

---

### Steam Overlap (steam_overlap)
- **平台**: PC (Steam)
- DataBrain 自有数据，**抽样爬取 300 万 Steam 用户样本**
- **仅包含 PCU > 1000 的游戏**
- **每周更新**
- 核心表（`_stg_` 前缀 = staging 表）:
  - `_stg_steam_overlap_game_user_count` — 游戏用户数 (by region, playtime threshold)
  - `_stg_steam_overlap_play_ab_user` — 两款游戏玩家重叠分析
  - `_stg_steam_overlap_wish_ab_user` — 愿望单重叠分析
  - `_stg_steam_overlap_playwish_ab_user` — 玩家+愿望单交叉重叠
  - 以上均有 `_by_country` / `_by_region` 变体
- 用途: 游戏用户画像重叠分析（"玩了 A 游戏的人有多少也玩了 B"）

---

## 查询失败时的标准回复模板

当查询失败或数据为空时，除了报告"数据不OK，任务未完成"，**必须**附带一句数据源限制说明。示例:

| 场景 | 附带说明 |
|------|----------|
| Sensortower 小国 DAU 为空 | "Sensortower DAU 仅覆盖大市场（global/cn/us/jp/kr等），小国市场 DAU 不可用" |
| Gamalytic 早期愿望单为 NULL | "Gamalytic 愿望单数据从 2023-09 起可用，该时间段无数据" |
| MScience 全球数据不准 | "M Science 全球数据=五国加总（美+英法德西），置信度低，建议仅参考美国数据" |
| 中国独占小游戏无 Sensortower 数据 | "该游戏为中国独占/小体量，Sensortower 未收录" |
| NPD 非美国市场查询 | "NPD 仅覆盖美国市场，其他国家无数据" |
| GSD 非欧洲市场查询 | "GSD 主要覆盖欧洲市场，该地区可能无数据" |
| Gamalytic 无国家维度 | "Gamalytic 仅提供 Steam 全球数据，不支持按国家拆分" |
| Steam Overlap 冷门游戏 | "Steam Overlap 仅含 PCU>1000 的游戏，该游戏可能未被采集" |
| Sensortower Overlap 无 global 市场 | "Sensortower App Overlap 表无 global 汇总行，未指定国家时默认使用美国（market='us'）" |
| Sensortower Overlap 冷门游戏无数据 | "Sensortower App Overlap 仅覆盖有一定体量的手游，该游戏可能未被收录" |
| VG Insights / AppAnnie | "该数据源已停用(DEPRECATED)，不可查询" |
