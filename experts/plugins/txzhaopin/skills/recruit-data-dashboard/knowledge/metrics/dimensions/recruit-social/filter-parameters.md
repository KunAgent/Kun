# 招活-社招｜运行时筛选参数（Filter Parameters）

> **本文件治理来源**：治理基线《社招统计指标》第 7 列「动态查询条件（默认值）」+ 第 8 列「固定查询条件」。
> **治理定位**：和「指标」「维度」并列的**第三类资产** —— 描述指标 SQL 在运行时**接收哪些参数 / 默认值 / 渲染规则**。
> **重要性**：没有本文件，指标卡只能算"半成品"——前端不知道传什么参数、AI 不知道把用户筛选条件挂在 SQL 哪一段。
>
> ⚠️ **核心原则**：参数 = 可被前端 URL/UI 控件下发的值；维度 = `GROUP BY` 的字段；强制过滤 = 业务上恒定的 `WHERE`。**三者职责不重叠**。

---

## 📋 参数全景表（v3.0 - 与 治理基线 新版对齐）

| # | 参数名（占位符） | 默认值 | 绑定字段（已验证） | 渲染模板 | 治理决策 |
| --- | --- | --- | --- | --- | --- |
| 1 | `:begin_date` | 当年 1 月 1 日（YTD） | 各时间字段（见各指标卡） | `>= :begin_date` | ✅ 必带 |
| 2 | `:end_date` | 昨天（T-1） | 同上 | `< DATE_ADD(:end_date, INTERVAL 1 DAY)` 或 `<= end_date+1天`（时点） | ✅ 必带 |
| 3 | `:manager_unit_name_cn` | **腾讯集团本部** | `manager_unit_name_cn`（中文名直接匹配） | `AND manager_unit_name_cn = :manager_unit_name_cn` | ✅ **建议必带**（"集团"≠"全部"） |
| 4 | `:mapping_position_name` | 全部 | `mapping_position_name` | `AND mapping_position_name = :mapping_position_name` | ⚠️ 可选 |
| 5 | `:recruit_owner` | 全部 | `recruit_owner`（招聘经理姓名） | `AND recruit_owner = :recruit_owner` | ⚠️ 可选 |
| 6 | `:location_country_name` | **中国**（`%中国%`） | `location_country_name` | `AND location_country_name LIKE :location_country_name` | ⚠️ 可选；**v3.0 起从固定→动态** |
| 7 | `:post_id` | 全部 | `post_id` | `AND post_id = :post_id` | ⚠️ 可选 |
| 8 | `:recruit_post_org_full_name` | 用户权限范围内所有组织 | 流程表：`recruit_post_org_full_name`<br>岗位表：`recruit_post_belong_org_full_name` | `AND recruit_post_org_full_name LIKE :recruit_post_org_full_name` | ⚠️ 可选（模糊匹配） |
| 9 | `:post_name_cn` | 全部（`%%`） | `post_name_cn` | `AND post_name_cn LIKE CONCAT('%', :post_name_cn, '%')` | ⚠️ 可选（模糊匹配） |
| 10 | `:is_disabled_name` | A 卡（在招类）：`'在招'`；B/D 卡（流程类）：`'全部'`（不带条件） | `is_disabled_name`（中文枚举：`'在招'/'停招'`） | `AND is_disabled_name = :is_disabled_name` | ⚠️ 可选；A 卡建议默认带 |



---

### 🌏 v3.1 决策（2026-06-09）：`:location_country_name` 参数使用示例

国家筛选**已从「强制过滤」改为「动态参数」**（v3.0 起，v3.1 进一步明确示例）。

| 用户意图 | 参数值 | 渲染后的 SQL 片段 |
| --- | --- | --- |
| 国内（默认） | `'%中国%'` | `AND location_country_name LIKE '%中国%'` |
| 亚太 | `'%亚太%'` | `AND location_country_name LIKE '%亚太%'` |
| 海外（除中国外） | `'%中国%'`（取反） | ⚠️ 需要业务侧二次定义；当前 schema 不直接支持 |
| 全球 | 不传参数 | （省略 WHERE） |
| 指定国家 | `'%日本%'`/`'%美国%'`/`'%新加坡%'` | `AND location_country_name LIKE :location_country_name` |

**skill 解析提示**：
- 用户提到"国内"/"中国" → 传 `'%中国%'`（默认）
- 用户提到"海外"/"全球"/"所有国家" → 省略此参数
- 用户提到具体国家/区域 → 包成 `'%xx%'` 传入
- 用户没提国家 → 默认 `'%中国%'`（保持业务习惯）



> **新版变化**（vs v2.x）：
> 1. **参数从 12 → 9 个**（精简，且全部已验证字段名）
> 2. **管理主体改用中文名 `manager_unit_name_cn`**（不再用 `manager_unit_id`），便于直接传"腾讯集团本部"等业务可读值
> 3. **国家字段从「固定过滤」→「动态参数」**（默认中国，可切全球）
> 4. **`is_disabled_name` 是中文枚举字段**（`'在招'/'停招'`），且**新版可在 WHERE 中安全使用**（旧版的拦截 bug 待重新验证，见下方 § 特殊参数 #1）
> 5. **删除了 `:next_date`**：新版直接用 `<= end_date+1天` 表达式替代，不再单独占位符化
> 6. **`channel_id` 不在 v3.0 参数表中**：治理基线 新版没列出，如有渠道筛选需求需业务对齐
> 7. **`work_location_id`**：治理基线 新版未列出，已剔除

| ❌ 已剔除参数 | 旧版位置 | 剔除原因 |
| --- | --- | --- |
| `manager_unit_id`（数字 ID） | v2.4 参数 #4 | 改用 `manager_unit_name_cn`（中文名）更直观；ID 仍可在 SQL 内部使用做兜底（10101=集团本部） |
| `org_id` | 治理基线 旧版第 7 列 | 行权限自动控权；按组织名过滤改用 `recruit_post_org_full_name`/`recruit_post_belong_org_full_name` |
| `:next_date` 占位符 | v2.x 参数 #3 | 新版规范化：直接用 `:end_date + INTERVAL 1 DAY` 表达式 |
| `channel_id` | v2.4 参数 #9 | 治理基线 新版未列；如需要按渠道筛选需业务对齐 |
| `work_location_id` | v2.4 参数 #10 | 治理基线 新版未列 |

> 🔴 **重要纠偏（2026-06-08，v2.4）**：早期版本（v2.2）把 `manager_unit_id` 当作"权限类参数"剔除，**这是误判**。
> - **行权限自动控权**只决定"我能看到哪些行"——一个用户的授权范围可能覆盖**多个管理主体**（如腾讯集团本部 + 云智研发中心 + 腾佳）
> - **"集团"是一个具体业务概念**：按 [`slangs/definitions.md`](../../../slangs/definitions.md)，集团 = 管理主体 `manager_unit_id = '10101'`（腾讯集团本部）
> - 用户筛"集团"时**必须显式过滤** `manager_unit_id`，否则会把所有授权管理主体的数据都加进来
> - **实测踩坑**：2026-06-08 查"今年集团发起面试数"，不带 `manager_unit_id` 过滤返回 36,054（含 3 个管理主体合计），带 `manager_unit_id='10101'` 才得到正确值 **29,052**

---

## 🔧 SQL 渲染契约

### 渲染策略：**条件性 AND 拼接**（推荐）

前端/SQL 拼装层在生成 WHERE 时，对每个**可选参数**判断"是否取了非默认值"再决定是否拼接 AND 块：

```js
// 伪代码（前端层）
const filters = {
  begin_date: '2026-01-01',  // 必带
  end_date:   '2026-06-07',  // 必带
  next_date:  '2026-06-08',  // 必带（A 卡）
  // 可选项（用户没选 → 不下发，或下发"全部"标识）
  post_id:           userInput.postId    || null,
  post_name_cn:      userInput.postName  || null,  // 模糊
  recruit_owner_id:  userInput.ownerId   || null,
  channel_id:        userInput.channelId || null,  // 模糊
  org_full_name:     userInput.orgKey    || null,  // 模糊
};

// 渲染 WHERE 子句
let where = `WHERE staff_type_id='2' AND flow_id=3` + (paramCountry ? ` AND location_country_name LIKE '${paramCountry}'` : ''); // v3.1: 国家为动态参数
if (filters.post_id)          where += ` AND t1.post_id = '${filters.post_id}'`;
if (filters.post_name_cn)     where += ` AND t1.post_name_cn LIKE '%${filters.post_name_cn}%'`;
if (filters.recruit_owner_id) where += ` AND t1.recruit_owner_id = '${filters.recruit_owner_id}'`;
if (filters.channel_id)       where += ` AND t1.channel_id LIKE '%${filters.channel_id}%'`;
if (filters.org_full_name)    where += ` AND t1.recruit_post_belong_org_full_name LIKE '%${filters.org_full_name}%'`;
```

> 实际生产建议用**预编译占位符**（如 mybatis `#{}` / JDBC `?`）防 SQL 注入，本文档示例用字符串拼接仅作可读性说明。

### 渲染示例（B 卡 SQL，带筛选参数）

```sql
SELECT
  -- ... B1-B10 各项 SUM(CASE ...) ...
FROM catalog_dos_da_mcp.hrdw.Report_Recruit_Flow_Detail t1
WHERE t1.staff_type_id = '2'                                                            -- 强制过滤
  AND t1.flow_id = 3                                                                    -- 强制过滤
  AND t1.location_country_name LIKE :location_country_name           -- 动态参数（默认 '%中国%'，v3.1）
  -- 以下条件根据用户筛选动态拼接
  /* if :post_id           */ AND t1.post_id           = :post_id
  /* if :post_name_cn      */ AND t1.post_name_cn      LIKE CONCAT('%', :post_name_cn, '%')
  /* if :recruit_owner_id  */ AND t1.recruit_owner_id  = :recruit_owner_id
  /* if :channel_id        */ AND t1.channel_id        LIKE CONCAT('%', :channel_id, '%')
  /* if :org_full_name     */ AND t1.recruit_post_belong_org_full_name LIKE CONCAT('%', :org_full_name, '%')
LIMIT 1000;
```

---

## ⚠️ 特殊参数处理

### 0. `:manager_unit_name_cn`（"集团"语义的核心）

新版 治理基线（v3.0）规定用**中文名直接匹配**，业务可读性更高：

```sql
AND manager_unit_name_cn = :manager_unit_name_cn   -- 默认值：'腾讯集团本部'
```

#### 两个管理主体口径

`Report_Recruit_Flow_Detail` 表有两组管理主体字段：

| 字段对 | 业务含义 | 默认绑定 |
| --- | --- | --- |
| `manager_unit_id` / `manager_unit_name_cn` | **招聘岗位所属管理主体** | ✅ 治理基线 默认绑定（业务问"为集团招了多少人"用此） |
| `recruit_owner_manager_unit_id` / `recruit_owner_manager_unit_name_cn`（如有） | **招聘经理所属管理主体** | ⚠️ 仅在业务问"集团的招聘经理招了多少人"时使用 |

**两个口径的差异**（实测 2026-06-08，今年集团发起面试数）：
- 按 `manager_unit_id = '10101'`（岗位侧）→ **29,052**
- 按 `recruit_owner_manager_unit_id = '10101'`（HR 侧）→ 22,022

#### 常见管理主体 ID ↔ 名称对照（兜底用）

| ID | 名称 | 业务标签 |
| --- | --- | --- |
| `10101` | **腾讯集团本部** | 🎯 业务术语"**集团**" |
| `10201` | 运营子公司 | — |
| `10203` | 腾佳 | — |
| `10206` | 云智研发中心 | — |
| `10301` | 腾讯音乐 | — |
| `10307` | 阅文集团 | — |
| `10302` | Webank | — |
| `10303` | 微保 | — |
| `10300xxx` | 海外游戏工作室（Riot/DE/Funcom 等） | — |
| `10200xxx` | 直管子公司 | — |
| `10400xxx` | 投资类子公司 | — |

> 完整字典见 `dw-api-public-dictionary-manage-unit-name` 表。
> SQL 中**优先用中文名**（`manager_unit_name_cn`）；ID（`manager_unit_id`）作为兜底/历史兼容。

---

### 1. `:is_disabled_name`（v3.0 起所有指标都可用）

✅ **WHERE 安全**（实测 2026-06-08 通过）：

```sql
-- 实测验证
SELECT is_disabled_name, COUNT(*) FROM Report_Position_Management_Recruitment_P_I_Daily_Slice GROUP BY is_disabled_name;
-- → 停招 115770 行 / 在招 4840 行

WHERE is_disabled_name = '在招'   -- → 返回 4840 行 ✅ 无拦截
```

| 业务场景 | 默认值 |
| --- | --- |
| **A 卡（在招类指标）** | `:is_disabled_name = '在招'`（治理基线 第 1 个固定条件） |
| **B/D 卡（流程类指标）** | 默认不带（`'全部'`），允许用户切换 |

#### vs 旧版 `is_disabled`（数字字段）的"WHERE 拦截 bug"

| 字段 | 类型 | WHERE 拦截 | 推荐用法 |
| --- | --- | --- | --- |
| `is_disabled`（数字 `0/1`） | INT | 🔴 实测被拦截（v2.x 历史 bug） | 永远不要在 WHERE 里用 |
| **`is_disabled_name`**（中文 `'在招'/'停招'`） | VARCHAR | ✅ **WHERE 安全** | **v3.0 起统一用此字段** |

> 治理建议：当 SQL 里需要按"岗位是否在招"过滤时，**统一用 `is_disabled_name`**，不再用 `is_disabled`。在 v2.x 时代为绕过 bug 而用的 `CASE WHEN is_disabled='1' THEN 0 ELSE person_count END` 写法，可以保留作为 person_count 的合并逻辑（不是"过滤逻辑"）。

🔴 **实测踩坑（2026-06-07）**：服务端对 `t2.is_disabled` 字段在 WHERE 中的使用做了**特殊行权限拦截**。

| 写法 | 行为 |
| --- | --- |
| `SELECT COUNT(*) FROM T_POST` | ✅ 12 万行 |
| `WHERE is_disabled = '0'` | 🔴 0 行（被拦截） |
| `CASE WHEN is_disabled = '1' THEN 0 ELSE person_count END` | ✅ 正常 |

✅ **正确做法**：把 `is_disabled` 写到 `CASE WHEN` 内，让禁用岗位的 `person_count` 记 0：
```sql
SUM(
  CASE
    WHEN t2.is_disabled = '1' AND t2.last_update_time < DATE_ADD(:end_date, INTERVAL 1 DAY) THEN 0
    ELSE COALESCE(t2.person_count, 0)
  END
  + COALESCE(reg.register_cnt, 0)
)
```
→ 详见 `derived/recruit-social/on-going-post.md` § 1。

### 2. 组织字段：流程表 vs 岗位表

新版 治理基线 明确列出了**两张表对应不同的组织字段名**：

| 来源表 | 字段名 |
| --- | --- |
| `Report_Recruit_Flow_Detail`（流程表，t1） | `recruit_post_org_full_name` |
| `Report_Position_Management_Recruitment_P_I_Daily_Slice`（岗位表，t2） | `recruit_post_belong_org_full_name` |

**渲染原则**：
- 单表查询 → 用对应表的字段
- 跨表 JOIN（如 A 卡）→ 两张表都要带筛选

### 3. `:post_name_cn` vs `:post_id`（互斥）

业务语义：
- `:post_id` → 精确匹配某一个岗位
- `:post_name_cn` → 模糊搜索岗位名（前端搜索框）

**前端规约**：用户填了 `post_id` 时，`post_name_cn` 应被忽略（精确优先）。

### 4. v3.0 已剔除参数说明

| 旧参数 | 剔除原因 |
| --- | --- |
| `:work_location_id` | 治理基线 v3.0 未保留（v2.x 时也"待校验"）；如需可使用 `location_country_name` 替代国家级筛选 |
| `:mapping_position_id` | 治理基线 v3.0 改用 `:mapping_position_name`（中文名直接匹配） |
| `:channel_id` | 治理基线 v3.0 未保留（"渠道发起面试率"指标里的"渠道"是分母概念，非筛选维度） |

---

## 🎯 适用范围矩阵（参数 × 卡片）

| 参数 | A 卡（需求/快照） | B 卡（环节数量） | C 卡（漏斗占比） | D 卡（辅助分母） |
| --- | :---: | :---: | :---: | :---: |
| `:begin_date` / `:end_date` | ✅ 必带 | ✅ 必带 | ✅ 必带 | ✅ 必带 |
| **`:manager_unit_name_cn`** | ✅ **建议必带（默认 `'腾讯集团本部'`）** | ✅ | ✅ | ✅ |
| `:location_country_name` | ✅（默认 `'%中国%'`） | ✅ | ✅ | ✅ |
| `:recruit_post_org_full_name` / `:recruit_post_belong_org_full_name` | ✅ | ✅ | ✅ | ✅ |
| `:post_id` | ✅ | ✅ | ✅ | ✅ |
| `:post_name_cn` | ✅ | ✅ | ✅ | ✅ |
| `:recruit_owner` | ✅ | ✅ | ✅ | ✅ |
| `:mapping_position_name` | ✅ | ✅ | ✅ | ✅ |
| `:is_disabled_name` | ✅ 默认 `'在招'` | ⚠️ 默认 `'全部'`（不带条件） | ⚠️ 同 B | ⚠️ 同 B |

---

## 📐 与「维度（dimensions/）」「强制过滤」的边界

```
┌─────────────────────────────────────────────────────────────────┐
│  指标 SQL 的 WHERE 子句构成                                       │
│                                                                 │
│  WHERE 强制过滤(staff_type_id/flow_id/location_country)         │
│    AND 时间窗(:begin_date / :end_date / :next_date)              │
│    AND 运行时筛选参数(可选: :post_id / :channel_id / ...)        │← 本文件治理对象
│  GROUP BY 维度（dim-org / dim-post / dim-recruit-owner / ...）   │← dimensions.md 治理对象
└─────────────────────────────────────────────────────────────────┘
```

| 资产类型 | 治理文件 | 角色 |
| --- | --- | --- |
| 强制过滤 | 各指标卡 `强制过滤` 字段 | 业务上**恒定**的 WHERE，不可被用户改 |
| 时间窗 | 本文件 #1-3 | 必带占位符 |
| **运行时筛选参数** | **本文件 #4-11** | **用户/前端可下发、可选 WHERE** |
| 维度（GROUP BY） | `dimensions.md` | 数据切片轴，不进 WHERE |

---

## 📅 维护记录

| 日期 | 变更 | 操作人 |
| --- | --- | --- |
| 2026-06-08 | 初始建立：从 治理基线 第 7 列「动态查询条件」抽出 11 个参数，剔除 2 个权限类参数，建立 SQL 渲染契约 | hr-ai-data agent |
| 2026-06-08 | **🔴 重要纠偏（v2.4）**：把误剔除的 `manager_unit_id` 重新加回参数表（位置 #4），明确"集团 = `manager_unit_id='10101'`"。澄清 `manager_unit_id`（招聘岗位侧，默认）vs `recruit_owner_manager_unit_id`（招聘经理侧）两个口径的差异，并补充常见管理主体 ID 字典。原因：行权限自动控权 ≠ 按管理主体过滤——用户授权范围常覆盖多个管理主体。今年集团发起面试数从 36,054（含 3 个管理主体）纠正为 **29,052**（仅集团本部） | hr-ai-data agent |
| 2026-06-08 | **v3.0 大版本升级（对齐新版 治理基线）**：参数从 12 个 → 9 个，全部字段名已实测验证。主要变化：① 管理主体改用中文名 `manager_unit_name_cn`（不再用 ID）；② **国家从「固定」→「动态」**（默认 `'%中国%'`，可切全球）；③ **`is_disabled_name` v3.0 起所有指标都可用且 WHERE 安全**（实测无拦截）；④ 删除 `:next_date` 占位符（直接用 end_date+1天 表达式）；⑤ 删除 `:channel_id` / `:work_location_id` / `:mapping_position_id`（治理基线 新版未列） | hr-ai-data agent |
