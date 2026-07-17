# 指标知识库（治理框架）

> 本目录是「指标定义」的权威来源，所有指标必须先在这里登记，才能被卡片/看板/SQL 引用。
> 治理理念：**按指标本质分层（原子/复合/派生），而非按展示位置（卡片/看板）分层**。

---

## 📐 治理框架

### 三层指标分类 + 两类伴随资产

| 资产 | 定义 | 数量（招活-社招） | 治理特点 |
| --- | --- | --- | --- |
| **🟢 原子指标 atomic/** | 单表 + 单聚合表达式，无任何依赖 | 25 个 | 最稳定的核心资产；所有上层指标的来源 |
| **🟠 复合指标 composite/** | 多个原子指标做四则运算（含比率、加法、平均） | 11 个 | 必须显式声明 `depends_on`，否则口径漂移 |
| **🟣 派生指标 derived/** | 含子查询、跨表 JOIN、时点状态快照 | 8 个 | 复杂度最高，使用前必须看「血缘」和「时点语义」 |
| **📐 维度 dimensions/** | `GROUP BY` 字段集（组织/岗位/招聘经理/渠道/工作地等） | 6 类 | 与指标解耦；指标卡只引用维度 ID |
| **🎚️ 运行时筛选参数 dimensions/*/filter-parameters.md** | 前端/UI 下发的可选 `WHERE` 参数（占位符 + 默认值 + 渲染模板） | 11 个（招活-社招） | **必须被指标 SQL 渲染层接收并加工**；权限类参数禁止重复添加 |

> ⚠️ **关键边界**：维度（`GROUP BY`）≠ 运行时筛选参数（`WHERE`）≠ 强制过滤（业务恒定的 `WHERE`）。三者职责不重叠，详见 [`dimensions/recruit-social/filter-parameters.md`](./dimensions/recruit-social/filter-parameters.md)。

### 治理 SOP（接入新指标的标准流程）

```
1. 治理基线/需求文档进来
   ↓
2. 拆解：哪些是原子（不可再分）？哪些是复合（依赖原子）？哪些是派生（含子查询/跨表）？
   ↓
3. 每个原子指标创建一张「指标卡」，含 11 项必填元数据
   ↓
4. 复合/派生指标显式声明 `depends_on: [atom-id-1, atom-id-2]`
   ↓
5. 维度独立到 dimensions/，指标卡只引用维度 ID
   ↓
6. recipes/ 给前端用法（卡片/看板/SQL 拼装样例）
```

### 指标卡的 12 项必填元数据（数据治理标准）

| # | 字段 | 说明 |
| --- | --- | --- |
| 1 | **指标 ID** | kebab-case，全库唯一，例 `recruit-entry-cnt` |
| 2 | **中文名** | 业务方使用的标准名 |
| 3 | **同义词** | 业务俗称、英文别名等检索锚点 |
| 4 | **类型** | atomic / composite / derived |
| 5 | **业务过程** | 指标在业务漏斗中的节点 |
| 6 | **数据源** | 完整 `catalog.db.table` 路径 |
| 7 | **关键字段** | SQL 中用到的标志位/时间字段 |
| 8 | **统计口径** | 人次/人数(去重)/百分比/天数/金额 |
| 9 | **时间字段** | 用于时间窗过滤的列名 |
| 10 | **强制过滤** | 业务上必须带的 WHERE 条件（如 `staff_type_id='2'`） |
| 11 | **支持的运行时筛选参数** | 该指标 SQL 可以被绑定的可选参数列表（来自 `filter-parameters.md`） |
| 12 | **业务负责人** | 由谁定义、由谁维护 |

复合/派生还要额外含：

| # | 字段 | 说明 |
| --- | --- | --- |
| 13 | **depends_on** | 依赖的原子指标 ID 列表 |
| 14 | **公式** | 业务公式（如「入职率 = 入职数 / 发送 offer 数」） |
| 15 | **兜底逻辑** | 分母为 0、空值等异常情况的处理 |

---

## 📁 目录结构

```
metrics/
├── README.md                                  # ⭐️ 本文件：治理框架说明
├── metric-index.md                            # 一站式索引（按多视角检索：类型/业务过程/数据源/卡片）
│
├── atomic/                                    # 🟢 原子指标（25 个）
│   ├── _README.md                             # 原子层使用说明
│   └── recruit-social/
│       ├── interview-count.md                 # 面试节点（11 个：发起/通过/未提交各类）
│       ├── offer-count.md                     # offer 节点（4 个：审批/发送/接受/放弃）
│       ├── salary-negotiation-count.md        # 薪资谈判（3 个）
│       ├── entry-count.md                     # 入职（1 个）
│       ├── resume-assess-count.md             # 简历评估（2 个）
│       └── giveup-count.md                    # 放弃/拒绝（2 个：turndown/拒 offer）
│       └── position-count.md                  # 招聘岗位（2 个：person_count、reg_offer_unsettled）
│
├── composite/                                 # 🟠 复合指标（11 个）
│   ├── _README.md
│   └── recruit-social/
│       ├── funnel-rates.md                    # 漏斗通过率（9 个）
│       ├── total-demand.md                    # 总需求数（加法）
│       └── avg-recruit-days.md                # 社招平均招聘天数
│
├── derived/                                   # 🟣 派生指标（8 个）
│   ├── _README.md
│   └── recruit-social/
│       ├── on-going-post.md                   # 在招需求数（含 register 子查询）
│       ├── snapshot-stages.md                 # 流程状态快照（5 个：全流程中/评估中/面试中/offer中/入职中）
│       └── finished-demand.md                 # 已完成需求数（入职/offer 两版）
│
├── dimensions/                                # 📐 维度定义 + 🎚️ 运行时筛选参数
│   ├── _README.md
│   └── recruit-social/
│       ├── dimensions.md                      # 组织/岗位/招聘经理/招聘渠道/工作地国家/职位族
│       └── filter-parameters.md               # ⭐️ 11 个运行时筛选参数（绑定字段+默认值+SQL 渲染模板）
│
├── recipes/                                   # 🍳 用法样例（前端/卡片/看板）
│   ├── _README.md
│   └── recruit-social/
│       ├── card-A-demand-overview.md          # A 卡片：需求与漏斗概览（12 项 SQL 拼装）
│       ├── card-B-funnel-counts.md            # B 卡片：环节通过/进度数量
│       ├── card-C-funnel-rates.md             # C 卡片：漏斗通过率
│       └── card-D-helper.md                   # D 卡片：辅助指标
│
└── recruit-social/_legacy/                    # 🗄️ 历史归档
    └── indicators-recruit-social.md           # ← 原文档（按 A/B/C/D 卡片分组），仅作历史参考
```

---

## 🚦 使用指引（不同角色看不同入口）

| 角色 | 入口 | 看什么 |
| --- | --- | --- |
| **数据生产者**（写 SQL） | `atomic/` + `composite/` + `dimensions/` | 找指标定义、组合维度、写查询 |
| **AI Agent**（自动检索） | `metric-index.md` | 按同义词/业务过程匹配指标 ID，再跳转到具体卡 |
| **业务方**（看口径） | `metric-index.md` 的「按业务过程」视图 | 漏斗节点导览 |
| **前端工程师**（拼卡片） | `recipes/` | 4 张卡片的完整 SQL 拼装样例 |
| **数据治理 owner**（审计） | `recruit-social/_legacy/` | 比对 治理基线，确认无信息丢失 |

---

## 🔑 关键约定

### 命名规则

- **指标 ID**：`<域>-<业务过程>-<度量>`，例 `recruit-entry-cnt`
- **域**：`recruit`（招聘）/ `staff`（员工）/ `org`（组织）/ `od`（OD）等
- **度量后缀**：
  - `-cnt` 计数
  - `-rate` 比率
  - `-days` 天数
  - `-amt` 金额
  - `-pct` 百分比

### 占位符

时间窗用冒号前缀命名占位符（StarRocks 风格）：`:begin_date` / `:end_date` / `:next_date`。

### 数据源短码

文档内引用表时优先用短码 + 一次完整声明，避免重复书写长 catalog 路径：

| 短码 | 完整路径 |
| --- | --- |
| `T_FLOW` | `catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail` |
| `T_POST` | `catalog_dos_da_mcp.hrdw.Report_Position_Management_Recruitment_P_I_Daily_Slice` |
| `T_ASSESS` | `catalog_dos_da_mcp.hrdw.Report_Recruit_Resume_Assessment` |

---

## 🔴 跨表 JOIN 与 T_ASSESS 表的两个关键勘误（2026-06-08 实测发现）

### 勘误 A：跨表 JOIN 必须用「子查询先过滤再 JOIN」模式

**实测**（2026-06-08）：

```sql
-- ❌ 失败：直接 JOIN 引用两表共有的 dos_current_user 行权限注入列冲突
SELECT COUNT(t1.flow_main_id)
FROM Report_Recruit_Flow_Detail t1
INNER JOIN Report_Position_Management_Recruitment_P_I_Daily_Slice t2 ON t1.post_id = t2.recruit_post_id
WHERE t1.staff_type_id = '2' AND t1.flow_id = 3;
-- → Error: Column 'dos_current_user' is ambiguous

-- ✅ 成功：先用子查询各自做过滤（StarRocks 在子查询内已注入控权），再 JOIN
SELECT COUNT(t1.flow_main_id) FROM
  (SELECT flow_main_id, post_id FROM Report_Recruit_Flow_Detail WHERE staff_type_id='2' AND flow_id=3) t1
INNER JOIN
  (SELECT recruit_post_id, is_disabled_name FROM Report_Position_Management_Recruitment_P_I_Daily_Slice WHERE is_disabled_name='在招') t2
ON t1.post_id = t2.recruit_post_id;
-- → 28,704 ✅
```

> 影响范围：所有 A 卡 SQL（涉及 T_FLOW + T_POST 两表 JOIN）。recipes/card-A v3.0 版本必须改写为子查询模式。

### 勘误 B：`Report_Recruit_Resume_Assessment` 的过滤条件**不带 flow_id**（2026-06-09 反向纠偏）

**🔴 重要纠偏**：早期版本（2026-06-08）曾错误地写下"T_ASSESS 中社招 = `flow_id = 2`，不是 3！"——**这是错误的猜测**，已全部清理。真实结论如下：

#### 真实结论（来自 治理基线「取值逻辑」精读）

T_ASSESS 表（`Report_Recruit_Resume_Assessment`）中"渠道收到评估数"和"渠道收到简历未评估数"的真实过滤条件**只有**：

```sql
arrive_time >= :begin_date
arrive_time < DATE_ADD(:end_date, INTERVAL 1 DAY)
-- ❌ 不应加 flow_id 过滤
```

#### 治理基线为什么会有"flow_id = 3"的字样？

治理基线「固定查询条件」一栏写了：
```
1、员工类型ID（Report_Recruit_Flow_Detail.staff_type_id）= 2
2、流程ID（Report_Recruit_Flow_Detail.flow_id） = 3
```

注意**字段路径是 `Report_Recruit_Flow_Detail.flow_id`**（不是 T_ASSESS）——这一行是**业务上下文标注**（说明此指标的语义是"社招简历评估"），并不指示在 T_ASSESS 表上加 `flow_id = 3` 的 WHERE。证据是 治理基线「取值逻辑」一栏明确只列了 `arrive_time` 和 `process_time`，未列 `flow_id`。

#### 错误猜测的来历（教训记录）

1. 实测 `T_ASSESS WHERE flow_id = 3` 返回 0 → 我错误推断"该表 flow_id 与 T_FLOW 不同"
2. 看到 `flow_id = 2` 行数最多（41w）→ 错误自认"2 = 社招"
3. 把这个未经业务方确认的猜测固化为治理结论 → 错误传播到 README/B 卡/C 卡
4. **正确做法应该是**：精读 治理基线「取值逻辑」一栏（实际 SQL 语义）而非「固定查询条件」（业务上下文标注）

> 影响范围：所有引用 T_ASSESS 的 SQL（B11、B12、C1）的过滤条件**应该删除任何 `flow_id = X` 的过滤**。`recruit-channel-resume-assess-cnt` / `recruit-channel-resume-not-assessed-cnt` 仅按时间窗 + 业务运行时参数过滤。

---

## 🚀 v3.0 升级摘要（2026-06-08 对齐新版 治理基线）

详细变更清单见 [`metric-index.md` 顶部 v3.0 升级摘要](./metric-index.md#-v30-升级摘要2026-06-08对齐-治理基线-新版)。核心变化：

1. **聚合方式**：`SUM(CASE WHEN ... THEN 1 ELSE 0 END)` → **`COUNT(DISTINCT CASE WHEN ... THEN flow_main_id END)`**
2. **参数表**：12 项 → 9 项（全部字段名实测验证通过）
3. **3 项新口径**：管理主体用中文名 `manager_unit_name_cn`、国家从固定改为动态、`is_disabled_name` v3.0 起 WHERE 安全
4. **指标变更**：+2 新增 / -2 废弃 / 4 改名（指标 ID 不变，仅中文名加"社招"前缀）

> ⚠️ 当前 atomic/composite/derived 文件中的 SQL 模板**仍以 v2.x 写法为主**（保留作为历史兼容），新增了 v3.0 推荐写法对照。新业务建议直接用 v3.0 写法。

---

## 🔴 数仓字段口径勘误（2026-06-08 实测，已批量修订）

⚠️ **关键事实**：`Report_Recruit_Flow_Detail` 表中**所有 `is_xxx` 标志位字段**的取值是**中文字符串 `'是' / '否'`**，**不是数字 `1 / 0`**。治理基线写法 `is_xxx = 1` 在 StarRocks 直查时**恒返回 0**。

### 已实测覆盖的 21 个字段（取值均为 `'是'/'否'`）

| 业务节点 | 字段 |
| --- | --- |
| 简历评估 | `is_resume_assess` |
| 发起面试 | `is_start_intv` |
| 部门内专业面试 | `is_start_dept_professional_intv`、`is_dept_professional_intv`、`is_dept_professional_intv_no_submit` |
| 通道面委面试 | `is_start_cf_intv`、`is_cf_intv`、`is_cf_intv_no_submit` |
| 用人决策面试 | `is_start_dm_intv`、`is_dm_intv`、`is_dm_intv_no_submit` |
| HR 资格面试 | `is_start_hr_intv`、`is_hr_intv`、`is_hr_intv_no_submit` |
| HR 薪资谈判 | `is_hr_salary_negotiation`、`is_hr_salary_negotiation_no_submit`、`is_know_salary_data` |
| Offer 审批 | `is_offer_approval`、`is_offer_approval_no_submit` |
| 发送 Offer | `is_send_offer` |
| 入职 | `is_entry` |

### 写法规范

| ❌ 错误（旧版，永远返回 0） | ✅ 正确（已批量替换） |
| --- | --- |
| `WHERE is_start_intv = 1` | `WHERE is_start_intv = '是'` |
| `CASE WHEN is_entry = 1 THEN 1 ELSE 0 END` | `CASE WHEN is_entry = '是' THEN 1 ELSE 0 END` |

**为什么 治理基线写 `= 1`**：业务方在 BI 工具（如帆软 / 自研 BI）层面做了字典映射；StarRocks 是源头存储，必须用真实值 `'是'`。

### ⚠️ 不要混淆：以下字段是真正的数字/字符串编码，**不属于本勘误**

| 字段 | 真实类型 | 写法 |
| --- | --- | --- |
| `flow_id` | 数字 | `flow_id = 3`（社招）/ `flow_id = 5`（活水） |
| `state_id` | 数字 | `state_id IN (5, 6)` / `state_id = 11` |
| `staff_type_id` | 字符串编码 | `staff_type_id = '2'` |
| `hr_salary_negotiation_state` | 中文枚举 | `= '放弃'` / `= '通过'` |

### 📌 未实测、需使用前验证的字段范围

- `Report_Recruit_Resume_Assessment` 表的 `is_xxx` 字段（如有）
- `Report_Position_Management_Recruitment_P_I_Daily_Slice` 表的 `is_disabled` 字段（实测过但语义复杂，见 [`derived/recruit-social/on-going-post.md`](./derived/recruit-social/on-going-post.md)）

---

## ⚠️ WHERE 子句的三层结构（社招专题）

所有招活-社招指标的 WHERE 子句必须按以下三层组织。三层来源不同、可变性不同、治理文件不同：

### 第 1 层：强制过滤（业务恒定，不可被用户改）

来自 治理基线 第 8 列「固定查询条件」：

```sql
-- 来自 Report_Recruit_Flow_Detail / Report_Recruit_Resume_Assessment 的指标
staff_type_id = '2'                       -- 员工类型（推测=正式社招候选人，TODO 验证）
flow_id = 3                               -- 社招（活水是 5）
location_country_name LIKE '%中国%'        -- 国内口径

-- 来自 Report_Position_Management_Recruitment_P_I_Daily_Slice 的指标
-- ⚠️ is_disabled 不能放 WHERE！见 filter-parameters.md § 特殊参数处理
```

### 第 2 层：时间窗（必带占位符）

```sql
AND <time_field> >= :begin_date
AND <time_field> < DATE_ADD(:end_date, INTERVAL 1 DAY)   -- 区间型
-- 或
AND <time_field> < DATE_ADD(:end_date, INTERVAL 1 DAY)                            -- 时点型（A 卡）
```

### 第 3 层：运行时筛选参数（可选，由前端 UI 控件下发）

来自 治理基线 第 7 列「动态查询条件（默认值）」，详见 [`dimensions/recruit-social/filter-parameters.md`](./dimensions/recruit-social/filter-parameters.md)：

```sql
/* if :post_id          */ AND t1.post_id          = :post_id
/* if :post_name_cn     */ AND t1.post_name_cn     LIKE CONCAT('%', :post_name_cn, '%')
/* if :recruit_owner_id */ AND t1.recruit_owner_id = :recruit_owner_id
/* if :channel_id       */ AND t1.channel_id       LIKE CONCAT('%', :channel_id, '%')
/* if :org_full_name    */ AND t1.recruit_post_belong_org_full_name LIKE CONCAT('%', :org_full_name, '%')
-- ... 共 11 个可选参数 ...
```

### ❌ 已剔除（StarRocks 已自动控权，禁止重复添加）

| 治理基线参数 | 剔除原因 |
| --- | --- |
| `org_id` | StarRocks 行权限自动按当前用户身份过滤；按组织名过滤改用 `:org_full_name` |

> 🔴 **v2.4 纠偏（2026-06-08）**：早期版本曾把 `manager_unit_id` 也剔除，**这是误判**——行权限自动控权 ≠ 按管理主体过滤。一个用户的授权范围可能覆盖多个管理主体（如腾讯集团本部 + 子公司 + 海外游戏工作室）。
> "集团" = `manager_unit_id = '10101'`（腾讯集团本部，详见 [`slangs/definitions.md`](../slangs/definitions.md)），用户筛"集团"时**必须显式过滤** `manager_unit_id`。详见 [`dimensions/recruit-social/filter-parameters.md`](./dimensions/recruit-social/filter-parameters.md) § 0。

---

## 📅 维护记录

| 日期 | 变更 | 操作人 |
| --- | --- | --- |
| 2026-06-07 | 初始建立治理框架 + 招活-社招专题 44 项指标接入 | hr-ai-data agent |
| 2026-06-07 | 重构：从 A/B/C/D 卡片分组 → atomic/composite/derived 三层治理结构 | hr-ai-data agent |
| 2026-06-08 | **复核加固：补全运行时筛选参数治理**（filter-parameters.md），把 治理基线 第 7 列「动态查询条件（默认值）」的 11 个参数结构化登记，剔除 2 个权限类参数；指标卡新增「支持的运行时筛选参数」必填字段；4 张 recipes 注入完整 WHERE 拼接模板 | hr-ai-data agent |
| 2026-06-08 | **🔴 字段口径勘误**：实测发现 `Report_Recruit_Flow_Detail` 中 9 个 `is_xxx` 标志位字段的取值是 `'是'/'否'`（非 `1/0`）。治理基线写法 `is_xxx = 1` 在 StarRocks 直查时返回 0；正确写法 `is_xxx = '是'`。已在 README 顶部添加红色警示。 | hr-ai-data agent |
| 2026-06-08 | **🔴 v2.4 重要纠偏：恢复 `manager_unit_id` 参数**——v2.2 把它当"权限类参数"剔除是误判。行权限自动控权 ≠ 按管理主体过滤；"集团"必须显式 `manager_unit_id='10101'`。澄清岗位侧 vs HR 侧两个口径。今年集团发起面试数从 36,054（含 3 个管理主体合计）纠正为 **29,052**（仅集团本部） | hr-ai-data agent |
| 2026-06-08 | **🚀 v3.0 大版本升级（对齐新版 治理基线）**：聚合从 SUM(CASE) → COUNT(DISTINCT flow_main_id)；参数 12→9 个；管理主体改用中文名；国家从固定→动态；`is_disabled_name` 全指标可用且 WHERE 安全；新增 2 指标 / 废弃 2 指标 / 改名 4 指标。详见 [`metric-index.md` v3.0 升级摘要](./metric-index.md#-v30-升级摘要2026-06-08对齐-治理基线-新版) | hr-ai-data agent |
