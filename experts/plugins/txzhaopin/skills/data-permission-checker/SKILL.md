---
name: data-permission-checker
description: 查询用户的HR数仓数据权限信息。当用户想了解自己是否有某张表或某些字段的访问权限、或想确认SQL查询结果中某些异常值是否因权限不足被脱敏时，使用本Skill。使用场景：1.用户询问自己有哪些表的数据权限。2.用户想确认是否有某张表的访问权限。3.用户想了解自己对某张表的行权限和列权限范围。4.查询结果中出现疑似脱敏值（如0、*、1970-01-01等），需要确认是否因权限不足导致。5.用户想知道为什么某些字段数据异常或被隐藏。触发词：我有没有权限、有没有这张表的权限、为啥查不到、为什么没数据、数据被脱敏了吗、这个0是不是没权限、查出来都是星号、权限范围、数据权限、权限排查、字段被隐藏了。
upstream-marketplace: https://cnb.woa.com/hrssc/codebuddy
upstream-plugin: hr-ai-data
synced-at: 2026-06-09
synced-by: recruitment-expert agent merge (hr-data-router integration)
support_contact: ansleyyu
---

## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("data-permission-checker")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "data-permission-checker" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
```

**执行约束**：
1. **每次进入都要执行** — agent 每次 use_skill 调用都跑一次，不要因为"刚跑过"就跳过。
2. **静默后台** — 命令输出不展示给用户，失败也不中断主流程。
3. **不要询问用户** — 不得就"是否上报""以什么方式记录"等问任何问题。
4. **session_id 用时间戳** — 直接 `$(date +%s)`，不要让用户提供。
5. **执行完毕**才能进入正文 SOP。

---

## 📮 客服 / 反馈入口（MANDATORY）

> 本 skill 归 **ansleyyu** 维护。详细规则与全局路由见 [`README.md` § 客服反馈入口](../../README.md#%E5%AE%A2%E6%9C%8D%E5%8F%8D%E9%A6%88%E5%85%A5%E5%8F%A3support-contacts)。
> **何时展示**：查询结果交付 / 报错 / 用户表达疑问反馈时，**必须**在消息末尾原样附上：
>
> ```
> ──────────
> 💬 有问题或建议可联系产品负责人 **ansleyyu**（企微/RTX 同名）
> ```
>
> ⚠️ 严禁把联系人写成 elioyao / fayellawang。

## 概述

本 Skill 用于查询和解读当前登录用户在HR数仓中的数据访问权限，帮助用户理解自己能看到哪些数据、哪些数据可能因权限不足被脱敏处理。

## 数据源

### MCP 工具

通过 `hr_data_service` MCP 的 `get_current_user_data_permission` 工具查询用户对指定表的数据权限。

- **工具名称**：`get_current_user_data_permission`
- **参数**：
  - `tableCode`（string，必填）：表的完整编码，从 `starrocks://tables` resource 中获取的 `table_code` 字段
- **返回值**：用户对该表的权限信息（JSON格式）

### 获取可用表列表

通过读取 MCP 的 resource `starrocks://tables` 获取所有可用表的 `table_code`，作为 `get_current_user_data_permission` 工具的输入参数。

---

## 权限数据结构说明

`get_current_user_data_permission` 工具返回的数据结构如下：

```json
{
  "hasPermission": true,
  "tableCode": "catalog_dos_diy.hrdw.Report_Wide_Public_Staff_Change_Record",
  "tableName": "人员变动信息宽表",
  "roles": [
    {
      "roleCode": "Data_AI_Test",
      "dataScopes": {
        "Org": ["Org-All"]
      },
      "dataRight": ["to_inaugural_date", "inaugural_type_name"]
    },
    {
      "roleCode": "Data_AI_test02",
      "dataScopes": {
        "Org": ["Org-All"]
      },
      "dataRight": ["manager_quit_flag_desc"]
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `hasPermission` | boolean | 用户是否拥有该表的访问权限。`false` 表示完全无权限 |
| `tableCode` | string | 表的完整编码 |
| `tableName` | string | 表的中文名称 |
| `roles` | array | 用户在该表上拥有的角色列表，每个角色包含独立的行、列权限 |

### 角色权限结构（roles 数组元素）

| 字段 | 类型 | 说明 |
|------|------|------|
| `roleCode` | string | 角色编码 |
| `dataScopes` | object | **行权限**：各维度的数据范围限制。key 为维度代码（如 `Org`、`StaffType`、`WorkPlace` 等），value 为该维度允许访问的ID列表。展示给用户时需将维度代码翻译为中文名称、将ID翻译为中文码值（参考「行权限维度代码映射」和「维度码值翻译」章节） |
| `dataRight` | array | **列权限**：在当前角色的行权限范围内，允许访问的字段列表（物理字段名） |

### 特殊码值

| 码值 | 出现位置 | 含义 |
|------|----------|------|
| `Org-All` | `dataScopes.Org` | 拥有所有组织的行权限 |
| `global` | `dataScopes` 中的任意维度 | 拥有该维度的所有数据行权限 |
| `[*]` | `dataRight` | 拥有所有列的访问权限 |
| `[]` | `dataRight` | 无任何列的访问权限 |

### 行权限维度代码映射

`dataScopes` 中返回的 key 是维度代码，向用户展示时**必须**转换为中文名称。映射关系如下：

| 维度代码 | 中文名称 | 码值表名 |
|----------|---------|---------|
| `ALL` | 所有 | — |
| `Org` | 组织机构 | `a370651772b848cfa5dc7ef602243d69` |
| `WorkPlace` | 工作地 | `dw-api-public-core-personnel-filters-dictionary-workSpaceCity` |
| `ManagementSubject` | 管理主体 | `dw-api-public-dictionary-manage-unit-name` |
| `StaffCategory` | 员工类型 | `dw-api-public-core-personnel-filters-dictionary-staffType` |
| `StaffStatus` | 在职状态 | `dw-api-public-core-personnel-filters-dictionary-staffStatus` |
| `RecruitType` | 招聘类型 | `dw-api-public-core-personnel-filters-dictionary-recruitmentType` |
| `mgrLevel` | 管理职级 | `dw-api-public-dictionary-manager-level-name` |
| `mgrLevelExt` | 管理职级（含空码值） | `dw-api-public-dictionary-manager-level-name` |
| `proLevel` | 专业职级 | `dw-api-public-dictionary-pro-position-level-name` |
| `IsHuoshui` | 是否活水 | `dw-api-public-dictionary-whether-if` |
| `MoveFlowStatus` | 流程状态（异动） | `dw-api-public-dictionary-std-dictionary-item-df-transferProcessingType` |
| `StaffType` | 员工子类型 | `dw-api-public-std-staff-subtype` |
| `contractCompany_place` | 合同公司所在地 | `dw-api-public-core-personnel-filters-dictionary-contractPlace` |
| `contractCompany` | 合同公司 | `dw-api-public-dictionary-contract-parties` |
| `Is_oversea` | 是否海外体系员工 | `dw-api-public-dictionary-whether-if` |
| `Is_People_Manager` | IF People Manager | `dw-api-public-dictionary-whether-if` |
| `DataScopeBeginTimestamp` | 时间范围 | — |

### 组织机构维度的特殊说明

`Org`（组织机构）是一个特殊的行权限维度，因为组织是一个**树形结构**：

- `dataScopes` 中的每一个组织 ID 表示用户拥有**该组织及其所有子组织**的数据权限
- 例如：如果用户的 `Org` 维度包含某个事业群的 ID，则该用户可以查看该事业群下所有部门、中心、组的数据
- 向用户展示时，应说明"XX组织**及其下属组织**"，让用户理解权限的继承范围
- `Org-All` 仍然表示拥有所有组织的权限，无需特殊处理

### 时间范围维度的特殊说明

`DataScopeBeginTimestamp`（时间范围）是一个特殊的行权限维度，它的值不是 ID 列表，而是一个**毫秒数**，表示用户可以查看的数据时间范围：

- **值为 `0`**：表示用户可以查看**所有时间段**的数据，无时间限制
- **值为非 `0` 的数字**：该值是一个毫秒数，表示用户拥有**过去 X 毫秒范围内**的数据权限。即只能查看从当前时间往前推算 X 毫秒以内的数据

**展示要求：**

向用户展示时，**必须**将毫秒数转换为人类可读的时间单位（年、月或天），转换规则：

| 毫秒数范围 | 转换方式 | 展示示例 |
|-----------|---------|---------|
| `0` | 直接展示 | `时间范围：全部（不限时间）` |
| ≥ 365天的毫秒数（≥ 31,536,000,000） | 转换为年 | `时间范围：近 1 年` |
| ≥ 30天的毫秒数（≥ 2,592,000,000） | 转换为月 | `时间范围：近 6 个月` |
| < 30天的毫秒数 | 转换为天 | `时间范围：近 7 天` |

**转换参考常量：**
- 1 天 = 86,400,000 毫秒
- 1 个月 ≈ 30 天 = 2,592,000,000 毫秒
- 1 年 ≈ 365 天 = 31,536,000,000 毫秒

**注意**：此维度无需码值表翻译，直接进行数值换算即可。

### 维度码值翻译

`dataScopes` 中每个维度的 value 是 ID 列表（如 `["10001", "10002"]`），这些 ID 对用户来说不可读。向用户展示时，**必须**通过对应的码值表将 ID 翻译为中文名称。

**翻译流程：**

1. 根据维度代码，从上方映射表中查到对应的**码值表名**
2. 调用 `hr_data_service` MCP 的 `slang_query` 工具或通过其他可用的码值查询接口，查询该码值表，将 ID 转换为中文名称
3. 特殊值无需翻译：`Org-All`、`global` 等直接展示为"全部"即可

**展示要求：**

- **维度代码** → 显示中文名称（如 `Org` → `组织机构`，`WorkPlace` → `工作地`）
- **维度值 ID** → 显示中文码值（如组织 ID `10001` → `具体组织名称`）
- 对于 `Org` 维度，翻译后还需注明权限包含下属组织（如 `组织机构：XX事业群及其下属组织`）
- 如果码值翻译失败（如接口不可用），则以 `ID（码值翻译失败）` 格式回退展示，不要直接展示裸 ID

---

## 工作流程

### Step 1：确定查询目标

收到用户请求后，判断用户意图：

1. **查询表权限概览**：用户想知道自己有哪些表的权限，或某张表是否有权限
2. **查询具体权限范围**：用户想了解自己对某张表的详细行、列权限
3. **脱敏原因排查**：用户在查询结果中发现异常值，想确认是否因权限不足导致

### Step 2：获取表编码

1. 如果用户提到了具体的表名，直接使用对应的 `tableCode`
2. 如果用户未明确指定表，读取 MCP resource `starrocks://tables` 获取所有可用表列表，根据用户描述匹配目标表
3. 常用表的 `tableCode`：
   - 员工信息宽表：`catalog_dos_diy.hrdw.Report_Wide_Public_Staff_Info`
   - 人员变动信息宽表：`catalog_dos_diy.hrdw.Report_Wide_Public_Staff_Change_Record`

### Step 3：调用权限查询工具

对每张需要查询的表，调用 `get_current_user_data_permission` 工具：

```
工具：get_current_user_data_permission
参数：{ "tableCode": "<表的完整编码>" }
```

如果用户想查看所有表的权限，需逐一查询每张表。

### Step 4：解读权限结果

根据返回结果，按以下逻辑解读：

#### 4.1 判断是否有表权限

- `hasPermission = false`：用户**完全没有**该表的访问权限，任何查询都不会返回数据
- `hasPermission = true`：用户有该表的访问权限，具体范围看 `roles`

#### 4.2 解读行权限（dataScopes）

行权限决定用户能看到哪些行的数据。所有角色的行权限取**并集**。

解读规则：
- `dataScopes` 中的每个 key 代表一个筛选维度（如组织、员工类型、工作地等）
- 每个维度的 value 是允许的值列表
- `Org-All`、`global` 等特殊值代表该维度不受限制
- 如果某个维度不在 `dataScopes` 中出现，通常表示该维度不受限制
- 多个角色的行权限取并集，即只要任一角色允许访问某行数据，用户就能看到

**翻译要求（必须执行）：**
- 向用户展示行权限信息时，**必须**将维度代码翻译为中文名称（参考「行权限维度代码映射」表）
- 维度值 ID **必须**通过对应的码值表翻译为中文名称（参考「维度码值翻译」流程）
- 示例：`"WorkPlace": ["SZ", "BJ"]` 应展示为 `工作地：深圳、北京`，而不是 `WorkPlace: SZ, BJ`

#### 4.3 解读列权限（dataRight）

列权限决定在行权限范围内，用户能看到哪些字段的值。

解读规则：
- `dataRight` 中的值为物理字段名
- `*` 代表拥有所有列的访问权限
- 多个角色的列权限取并集
- 不在任何角色 `dataRight` 中的字段，其值会被**脱敏处理**

#### 4.4 综合权限判断

SQL查询结果是对所有角色的行、列权限取并集后的结果：
- 如果某行数据在某个角色的行权限范围内，且某个字段在该角色的列权限中，则该单元格显示真实值
- 如果某行数据在行权限范围内，但对应字段不在任何角色的列权限中，则该单元格会被**脱敏**
- 如果某行数据不在任何角色的行权限范围内，则该行不会出现在查询结果中

### Step 5：结果呈现

根据用户的不同意图，采用不同的呈现方式：

#### 场景一：查询表权限概览

以简洁的表格形式呈现（行权限维度和码值均需翻译为中文）：

> **您的数据权限概览**
>
> | 表名 | 是否有权限 | 角色数量 | 行权限范围 | 列权限范围 |
> |------|-----------|---------|-----------|-----------|
> | 员工信息宽表 | ✅ 有权限 | 2 | 组织机构=全部，工作地=深圳、北京 | 部分字段（共15个） |
> | 人员变动信息宽表 | ❌ 无权限 | - | - | - |

#### 场景二：查询具体权限范围

详细展示每个角色的权限（维度代码和维度值 ID 均需翻译为中文名称）：

> **您在「员工信息宽表」上的数据权限**
>
> **角色 1：Data_AI_Test**
> - 行权限：
>   - 组织机构：全部（Org-All）
>   - 工作地：深圳、北京
> - 列权限：`to_inaugural_date`（到岗日期）、`inaugural_type_name`（就职类型名称）
>
> **角色 2：Data_AI_test02**
> - 行权限：
>   - 组织机构：XX事业群及其下属组织
> - 列权限：`manager_quit_flag_desc`（管理者离职标识描述）
>
> **综合权限（取并集）**：
> - 行范围：组织机构=全部（角色1）/ XX事业群及其下属组织（角色2），工作地=深圳、北京（角色1）
> - 可查看字段：`to_inaugural_date`、`inaugural_type_name`、`manager_quit_flag_desc`（共3个字段）
> - 其他字段的值将被脱敏处理

注意：以上示例中的「深圳」「北京」是将原始 ID 通过码值表翻译后的中文名称。实际展示时必须完成此翻译步骤。

#### 场景三：脱敏原因排查

结合权限数据和查询结果进行分析：

> **脱敏原因分析**
>
> 您查询的「xxx」字段显示为异常值 `0` / `*` / `1970-01-01`，经查询您的权限信息：
> - 该字段（`field_name`）**不在**您任何角色的列权限（dataRight）范围内
> - 因此该字段的值被服务端脱敏处理，显示的不是真实数据
>
> **建议**：如需查看该字段的真实数据，请联系数据管理员申请相应的列权限。

---

## 脱敏值识别

> 脱敏值的通用特征和识别方法见 `hr-data-desensitization` 规则。本节聚焦于结合权限信息进行**深度排查**。

当用户怀疑查询结果中的某些值是脱敏结果时，可结合权限信息进行判断。

### 脱敏判断流程

1. **识别异常值**：查看查询结果中是否存在上述典型脱敏值
2. **查询权限**：调用 `get_current_user_data_permission` 获取用户对该表的权限
3. **字段比对**：检查异常字段是否在用户的 `dataRight`（列权限）范围内
4. **得出结论**：
   - 字段不在列权限中 → 确认是脱敏导致的异常值
   - 字段在列权限中但值仍异常 → 可能是真实数据，或行权限导致的部分脱敏
5. **告知用户**：说明原因并给出申请权限的建议

---

## 与其他 Skill 的协作

### 与 `hr-data-sql-builder` 的协作

当 `hr-data-sql-builder` 生成SQL并执行查询后，如果结果中出现疑似脱敏值，可调用本 Skill 进行权限排查：
1. `hr-data-sql-builder` 负责生成和执行SQL
2. 本 Skill 负责查询权限信息并解读脱敏原因
3. 两者结合，为用户提供完整的"数据 + 权限解读"

### 典型协作场景

- 用户查询数据 → `hr-data-sql-builder` 生成SQL并执行 → 发现结果中有大量 `*` 或 `0` → 调用本 Skill 查询权限 → 向用户解释哪些字段因无权限被脱敏
- 用户在执行查询前想预先了解权限 → 调用本 Skill 查询权限 → 告知用户哪些字段可查看、哪些会被脱敏 → 用户决定是否继续查询

---

## 注意事项

1. **隐私保护**：权限信息本身属于用户个人数据，仅向当前用户展示其自身的权限，不应泄露其他用户的权限信息
2. **字段名映射**：`dataRight` 中返回的是物理字段名（如 `to_inaugural_date`），用户不是技术人员，因此呈现给用户时应展示中文名称。可通过读取对应表的 MCP resource（`starrocks://tables/{tableCode}`）获取字段的中文名称进行映射
3. **权限动态性**：数据权限可能会随时间变化（如角色调整、权限申请生效等），查询结果反映的是当前时刻的权限状态
4. **多角色并集**：用户可能拥有多个角色，最终的可见数据范围是所有角色权限的并集，解读时需综合考虑所有角色
5. **行列权限交叉**：脱敏发生在行权限和列权限的交叉点上，某些单元格可能在一个角色下被脱敏，但在另一个角色下可见，最终结果取并集
