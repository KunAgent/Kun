# 消歧规则

> 用户的模糊表达 → 明确指向哪个指标 / 哪种处理

## v3.1 决策（2026-06-09）

### "流程中"

| 用户问法 | 默认指标 |
| --- | --- |
| "流程中" / "进行中" / "在跑的" / "全部流程中" | `recruit-flow-total-count`（社招流程中总人数，**含简历评估**）|
| "面试中（不含评估）" / "已开始面试" / "除评估" | `recruit-flow-no-assess-count`（社招流程中（不含简历评估））|

### "总需求 vs 在招 vs 已完成"

| 用户问法 | 指标 |
| --- | --- |
| "在招" / "正在招" / "还在招" | `recruit-on-going-post-count`（社招在招需求数）|
| "已完成" / "招完了" + 不带"offer"字 | `recruit-finish-post-onboard-cnt`（已完成需求数·入职口径）|
| "已完成" + 带 "offer" 字 | `recruit-finish-post-offer-cnt`（已完成需求数·offer 口径）|
| "总需求" / "总共要招" | `recruit-total-post-count`（社招总需求数 = 在招 + 已完成入职）|

### "入职"

| 用户问法 | 指标 |
| --- | --- |
| "入职数" / "入职多少人" / "招到了几个" | `recruit-entry-cnt`（社招入职数，原子）|
| "入职率" / "入职转化" | `recruit-entry-rate`（入职率，复合）|

### "通过率" / "转化率"

如果用户没说具体环节，默认给**整个漏斗的所有通过率**（B 类卡片）。
如果指定某环节，按业务节点匹配对应 rate 指标：

| 环节 | 通过率指标 |
| --- | --- |
| 部门内 | `recruit-dept-professional-intv-rate` |
| 通道面委 | `recruit-cf-intv-rate` |
| 用人决策 | `recruit-dm-intv-rate` |
| HR 资格 | `recruit-hr-intv-rate` |
| HR 薪资谈判 | `recruit-hr-salary-negotiation-rate` |
| 发送 offer | `recruit-send-offer-rate` |
| 入职 | `recruit-entry-rate` |

### 组织名识别

| 用户说 | skill 行为 |
| --- | --- |
| "集团" / "集团本部" | 强制带 `manager_unit_name_cn = '腾讯集团本部'`（不只是 LIKE 部门名）|
| "CSIG" / "IEG" / "WXG" / "PCG" / "TEG" 等 BG 名 | `recruit_post_org_full_name LIKE '%XXX%'` |
| 具体部门名（如"运营管理部"）| `recruit_post_org_full_name LIKE '%运营管理部%'` |
| "我的部门" | 调 `get_current_user()` 拿组织全路径 |
| "子公司" | `manager_unit_name_cn != '腾讯集团本部'`（注意：要根据用户授权确定有哪些子公司主体）|

### 时间表达

| 用户说 | begin_date | end_date |
| --- | --- | --- |
| 未说 / "今年" / "YTD" | 当年 1 月 1 日 | 昨天 |
| "今年 5 月" | 当年 5 月 1 日 | 当年 5 月 31 日（或当前月内的"昨天"取其小）|
| "Q1" | 当年 1 月 1 日 | 当年 3 月 31 日 |
| "上个月" | 上月 1 日 | 上月最后一日 |
| "近半年" | 今天 - 6 个月 | 昨天 |
| "近一周" | 今天 - 7 天 | 昨天 |

### 国家

| 用户说 | 参数值 |
| --- | --- |
| 未说 / "国内" / "中国" | `'%中国%'`（默认）|
| "海外" / "全球" / "全部国家" | 省略此参数 |
| "亚太" | `'%亚太%'` |
| 具体国家（"日本"、"新加坡"）| `'%日本%'` |

## 易踩坑的指标对（v3.1 易混淆扫描）

| A | B | 区分要点 |
| --- | --- | --- |
| 社招流程中总人数 | 社招流程中（不含简历评估） | 看是否含"评估"字 |
| 社招已完成需求数（入职）| 社招已完成需求数（offer）| 默认入职口径，除非用户明确说 offer |
| 渠道收到评估数 | 渠道收到简历未评估数 | 后者是前者的子集（待评估的部分）|
| 发起 X 面试数 | X 面试通过数 | "发起"vs"通过"是不同节点 |
| 发起 X 面试数 | 发起 X 面试未提交数 | "未提交"是已发起但未处理 |

## 拒绝场景

| 用户问题 | skill 行为 |
| --- | --- |
| 涉及校招（毕业生/实习生）| "本 skill 仅覆盖社招。可调用 hr-data-sql-builder skill 处理校招查询。" |
| 涉及编制 / HC | "本 skill 仅覆盖社招。编制相关问题请用 hr-data-sql-builder + 编制宽表" |
| 涉及离职 / 异动 | 同上 |
| 涉及绩效 / 梯队 | 同上 |
| 个人隐私（具体某人的薪酬）| 按 `hr-data-desensitization` 规则拒绝 |

---

## v3.2 关于活水的处理（2026-06-09 决策）

**重要原则**：skill **不主动**对活水做包含/排除过滤。用户问什么按字面查。

| 场景 | skill 行为 |
| --- | --- |
| 用户问"社招入职数" / "社招..." | 按用户字面要求加 `flow_id = 3` |
| 用户问"入职数" / "招聘..." 等中性词 | **不**主动加 `flow_id` 过滤；按指标卡的强制过滤来 |
| 用户问"活水" / "内部流动" | 按字面加 `flow_id = 5`，注意活水不走 `is_xxx` 标志位，要用 `huoshui_*_time` 字段 |

**重要事实**（2026-06-09 实测验证）：
- 活水分支（`flow_id = 5`）的 `is_entry` / `is_send_offer` / `is_start_intv` 等标志位**全部为空**（`'否'` 或 NULL）
- 活水有自己一套时间字段：`huoshui_transfer_date`（活水调动日期，**敏感**）、`huoshui_in_dept_approval_time`、`huoshui_giveup_time`
- 因此 `flow_id IN (3,5) AND is_entry='是'` 实际上**只统计到社招分支**（活水永远不命中）

**数据偏差提示**：何时触发详见 [`SKILL.md` § Step 5 数据偏差提示规则](../SKILL.md)。简言之：
- WHERE / GROUP BY 涉及职位（`mapping_position_*` / `post_id` / `post_name_cn`）
- WHERE / GROUP BY 涉及职级（`mapping_position_level_name` / `form_init_manager_level_name` / 含 `_level_` 字段）
- WHERE / GROUP BY 涉及候选人姓名（`candidate_name_cn` / `candidate_name_en`）
- → 任一触发即在回答末尾追加统一偏差提示文案

---

## v3.3 关于组织匹配 + 默认管理主体（2026-06-10 决策）

### 1. 🔴 BG 中文全路径速查表（永远用中文，禁用英文缩写）

实测发现：组织命名标准化中部分路径英文用 BG 缩写、中文用其他名字（如某些二级中心），导致 `LIKE '%TEG%'` 和 `LIKE '%TEG技术工程事业群%'` 命中范围不一致。**必须用英文前缀+中文全路径**（如 `LIKE '%TEG技术工程事业群%'`）。

| BG 简称 | ❌ 错误（仅命中部分）| ✅ 正确（中文全路径）|
| --- | --- | --- |
| TEG | `LIKE '%TEG%'` | `LIKE '%TEG技术工程事业群%'` |
| CSIG | `LIKE '%CSIG%'` | `LIKE '%CSIG云与智慧产业事业群%'` |
| IEG | `LIKE '%IEG%'` | `LIKE '%IEG互动娱乐事业群%'` |
| PCG | `LIKE '%PCG%'` | `LIKE '%PCG平台与内容事业群%'` |
| WXG | `LIKE '%WXG%'` | `LIKE '%WXG微信事业群%'` |
| CDG | `LIKE '%CDG%'` | `LIKE '%CDG企业发展事业群%'` |
| S1 | `LIKE '%S1%'` | `LIKE '%S1职能系统－职能%'` |
| S2 | `LIKE '%S2%'` | `LIKE '%S2职能系统－财经%'` |
| S3 | `LIKE '%S3%'` | `LIKE '%S3职能系统－HR与管理%'` |

### 2. 🔴 默认管理主体 = '腾讯集团本部'（v3.3 强化）

| 用户表达 | `manager_unit_name_cn` 处理 |
| --- | --- |
| **未说管理主体** | **必带 `'腾讯集团本部'`**（治理基线默认值） |
| "含子公司" / "全部主体" / "整个公司" | 省略此过滤，**回答中明确说明含哪些主体** |
| 具体子公司名（"云智研发中心"等） | 用户明示的具体值 |

**实证**（2026-06-10）：TEG 当前在招需求数
- 不加管理主体过滤：342 人（含「云智研发中心」管理的 4 个岗位 6 人）
- 默认带 `manager_unit_name_cn = '腾讯集团本部'`：**336 人**
- 这 6 人不是数据噪声，是真实存在的子公司主体下挂在 TEG 路径的岗位

### 3. 🔴 永远以治理基线为最终真相源

如果指标卡 SQL 模板与治理基线「指标取值逻辑」冲突，**以治理基线为准**，并提示该指标卡需要修订。已知历史踩坑：

- v3.0~v3.2 `on-going-post.md` 把治理基线的"加法"误写成 `LEFT JOIN` —— v3.3 已修正
- v3.0~v3.2 `on-going-post.md` 用 `is_disabled='1'` 反向逻辑 —— 治理基线是 `is_disabled_name = '在招'` 直接 WHERE，v3.3 已修正
- send_offer_time 方向：治理基线 `>= end_date` 不是笔误，是有意为之的反向时点设计（详见 `on-going-post.md`）
