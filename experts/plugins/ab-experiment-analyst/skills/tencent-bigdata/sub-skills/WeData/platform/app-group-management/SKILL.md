---
name: app-group-management
description: 当用户需要在 WeData 控制台管理应用组（AppGroup）时使用此技能。支持查询应用组详细信息（成员、管理员、所属 BG/部门、所属 TDW 集群等）、申请加入应用组（走审批流，可选角色 MANAGER/MEMBER）、退出应用组（不可逆，需二次确认）。触发关键词：应用组、AppGroup、app group、查询应用组、应用组详情、应用组信息、应用组成员、申请加入应用组、加入应用组、退出应用组、离开应用组。
---

# 应用组管理（App Group Management）

## 1. 概述

通过 WeData 平台对应用组（AppGroup）进行管理。本技能封装 3 个原子操作：

| 子技能 | 接口 | 鉴权 | 是否危险 |
|--------|------|------|---------|
| 查询应用组详情 | `DescribeAppgroup` | tauth | 否 |
| 申请加入应用组 | `ApplyJoinAppgroup` | tauth + 代理用户 rtx | 否（走审批流） |
| 退出应用组 | `QuitAppgroup` | tauth + 代理用户 rtx | **是，不可逆** |

**核心用途**：让用户通过命令行快速完成 WeData 控制台上常见的应用组管理操作，避免在网页端反复点击。

> 底层接口的 OpenAPI host 与 path 由 CLI 侧统一封装（`do_cli/sub-cli/WeData/app-group-management/scripts/app_group_client.py`），本技能不直接暴露。

## 2. 触发条件

### 2.1 触发场景
- 查看某个应用组的详情（成员、管理员、所属 BG/部门、所属 TDW 集群等）
- 申请加入某个应用组（自己加入或代理申请）
- 退出当前所在的某个应用组
- 关键词：应用组、AppGroup、app group、查询/申请加入/退出应用组

### 2.2 不触发场景
- SQL 执行 / 数据探索 → `sql-execute-analyze`
- 数据分析 / ChatBI → `chatbi`
- SQL 生成 / 诊断 / 预检 → `supersql-codegen` / `supersql-diagnosis` / `prediagnosis_skills`
- Notebook 操作 → `notebook`
- 应用组**创建 / 删除 / 修改配额 / 转让管理员**（本技能仅 describe / apply-join / leave）
- 项目空间管理（不在本技能范围内）

## 3. 执行规则

- **隐藏底层细节**：不向用户展示原始命令行（`do-bigdata wedata ...`）和原始 JSON 输出，只提取关键信息以结构化方式呈现。
- **分步进度反馈**：
  1. 凭证 / 鉴权检查 → 「正在验证凭证...」 → 「凭证验证通过 ✓」
  2. 查询 → 「正在查询应用组信息...」 → 展示结果
  3. 申请加入 → 「正在提交加入申请...」 → 「申请已提交，待审批 ✓ 审批链接：...」
  4. 退出 → 「正在退出应用组...」 → 「已退出 ✓」
- **危险操作二次确认**：
  - **退出应用组**是不可逆操作，AI Agent **必须**严格执行第 6.3 节「用户确认 SOP」的 4 步流程；任何模糊回复（如"是""yes""确认"）都判为取消。**严禁**未完成 SOP 直接调用 `leave-app-group`。
  - **申请加入**需向用户确认申请理由（`Reason`），避免提交空白申请。
- **GroupRole 默认值反直觉警告**：底层接口 `GroupRole` 默认是 `MANAGER`（负责人），不是 `MEMBER`。CLI 层强制要求显式指定 `--group-role`，不允许走默认值，避免误申请成管理员。
- **错误处理**：
  - 查询失败 → 区分"应用组不存在 / 名称拼写错误"和"无权限查看"，引导核对 `AppgroupName`（大小写敏感）。
  - 申请加入失败 → 区分"已是成员"、"已有待审批申请"、"应用组不开放申请"等情形。
  - 退出失败 → 区分"非成员"、"管理员不能退出（需先转让）"等情形。
  - 通用参数缺失错误码：`InvalidParameter.CsParameterValueNullError`，出现时检查 `AppgroupName`/`Users`/`UserType` 等必填项是否已传。

## 4. 前置步骤：凭证检查

在执行任何操作前，**必须先检查凭证是否已配置且有效**。

```bash
do-bigdata auth status
```

- **凭证存在且有效**：进入工作流程。
- **凭证不存在或失效**：**立即停止**，引导用户配置：

> 需要先配置 CMK 凭证才能使用 WeData 平台管理技能：
> 1. 访问 https://wedata.woa.com/security/user/keys 下载个人 CMK 文件
> 2. 配置凭证：
> ```bash
> do-bigdata auth init --user <RTX> --cmk <CMK密钥> --cmk-id <CMK_ID>
> # 或从 CMK JSON 文件内容解析
> do-bigdata auth init --from-json '{"id":...,"subject":"xxx","key":"xxx","type":"cmk"}'
> ```

> [WARN] **底层鉴权说明**：本技能 3 个接口由 CLI 在底层走 tauth 鉴权。其中 `ApplyJoinAppgroup` 和 `QuitAppgroup` **必须使用平台运行账号代理用户 rtx 生成 tauth token**，CLI 会基于配置的 CMK 自动完成代理鉴权，用户无需关心。

### 4.1 凭证三级 fallback（CLI 内部）

| 优先级 | 来源 | 适用场景 |
|--------|------|----------|
| 1 | 环境变量 `DO_BIGDATA_USER` / `DO_BIGDATA_CMK` / `DO_BIGDATA_CMK_ID` | CI/CD、临时使用 |
| 2 | 加密文件 `security_file/config.json.enc` | 日常使用（推荐） |
| 3 | 明文文件 `security_file/config.json` | 向后兼容 |

## 5. 子技能一：查询应用组详细信息

调用 `DescribeAppgroup` 获取应用组完整信息。

### 5.1 CLI 命令

```bash
do-bigdata wedata describe-app-group --appgroup-name "<AppgroupName>"
```

### 5.2 参数

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `--appgroup-name` | 是 | string | 应用组名（接口字段 `AppgroupName`，如 `g_teg_tdwtest_xxx`） |

### 5.3 接口返回字段（`Response.Data`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `Id` | int | 应用组数字 ID |
| `Name` | string | 应用组名（如 `g_teg_tdwtest_xxx`） |
| `Alias` | string | 应用组别名（如 `[同乐]xxx`） |
| `ClusterId` | int | TDW 集群 ID |
| `ClusterName` | string | TDW 集群名称（如 `同乐`） |
| `BgId` | int | 所属 BG ID（如 `958`） |
| `BgName` | string | 所属 BG 名称（如 `TEG技术工程事业群`） |
| `FullDeptId` | string | 完整部门 ID 路径（如 `958/54756/8263`） |
| `FullDeptName` | string | 完整部门名称路径（如 `TEG技术工程事业群/数据计算平台部/数据中心`） |
| `Managers` | array | 管理员列表 |
| `Members` | array | 成员列表 |
| `CreateTime` | long | 创建时间（13 位毫秒级时间戳） |
| `UpdateTime` | long | 更新时间（13 位毫秒级时间戳） |
| `Description` | string | 描述 |

### 5.4 典型错误处理

| 错误类型 | 处理建议 |
|---------|---------|
| 应用组不存在 / 名称拼写错误 | 提示用户核对 `AppgroupName`（大小写敏感） |
| 无权限查看 | 提示当前账号无权访问该应用组 |
| `InvalidParameter.CsParameterValueNullError` | 检查 `AppgroupName` 是否传入 |

## 6. 子技能二：申请加入应用组

调用 `ApplyJoinAppgroup` 发起加入申请，进入审批流，由应用组管理员审批。

### 6.1 CLI 命令

```bash
do-bigdata wedata apply-join-app-group \
  --appgroup-name "<AppgroupName>" \
  --users "<rtx_or_account>" \
  --user-type "entity" \
  --group-role "MEMBER" \
  --reason "<申请理由>"
```

### 6.2 参数

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `--appgroup-name` | 是 | string | 应用组名（接口字段 `AppgroupName`） |
| `--users` | 是 | array(string) | 申请加入的用户列表（接口字段 `Users`），CLI 支持多次传入或逗号分隔 |
| `--user-type` | 是 | enum | 用户类型（接口字段 `UserType`）：`entity`（OA 账号）或 `platform_run`（平台运行账号） |
| `--group-role` | **强制显式** | enum | 加入角色（接口字段 `GroupRole`）：`MANAGER`（负责人）或 `MEMBER`（成员）；**底层默认 `MANAGER`，CLI 强制显式传入** |
| `--reason` | 推荐 | string | 申请理由（接口字段 `Reason`），建议 ≥ 10 字符以便审批人决策 |

### 6.3 接口返回字段（`Response.Data`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `ProcessInstId` | int/long | 审批流程实例 ID |
| `ProcessDetailUrl` | string | 审批详情链接（用户可直接访问 / 转交审批人加速处理） |

### 6.4 典型错误处理

| 错误类型 | 处理建议 |
|---------|---------|
| 已是该应用组成员 | 提示无需重复申请（可先调用 `describe-app-group` 在 `Members` 中验证） |
| 已有待审批申请 | 提示已有进行中的审批单，建议联系审批人加速 |
| 应用组不开放申请 | 引导用户改为联系应用组负责人（`Managers`）手动添加 |
| 应用组不存在 / 名称拼写错误 | 提示核对 `AppgroupName`（大小写敏感） |
| `InvalidParameter.CsParameterValueNullError` | 检查 `AppgroupName`/`Users`/`UserType` 是否传入 |

## 7. 子技能三：退出应用组（高危）

调用 `QuitAppgroup` 退出应用组。

> [ALERT] **高危操作 — 不可逆**
> - 退出后**立即失去**对该应用组下所有资源的访问权（库表数据、计算资源、调度任务等）
> - **无法自行回退**，重新加入必须走 `apply-join-app-group` 重新审批
> - 退出对象 = **当前 CLI 已登录的用户本人**（tauth 代理的 rtx），不能代他人退出
> - **AI Agent 在调用本子技能前必须严格执行下方"用户确认 SOP"，未取得用户明确确认前禁止调用 CLI**

### 7.1 用户确认 SOP（AI Agent 必做，4 步缺一不可）

**Step 1 — 解析当前用户名**
通过 `do-bigdata auth status`（或读取环境变量 `DO_BIGDATA_USER`）拿到当前已登录的 rtx，**这就是即将退出应用组的人**。CLI 端 `leave-app-group` 也会将该 rtx 作为 tauth `proxyUser` 传给 OpenAPI，与 SOP 解析结果一致。

**Step 2 — 校验成员身份**
先调用 `describe-app-group --appgroup-name <name>`，确认该 rtx 出现在 `Members` 或 `Managers` 列表中：
- 不在列表中 → 直接告知"无需退出"，**终止流程**，不调用 `leave-app-group`
- 在 `Managers` → 告警"您是该应用组的管理员，退出前请先转让管理员权限"，**终止流程**

**Step 3 — 强风险提示 + 显式二次确认**
向用户输出**完整确认信息**（必须同时包含 4 个要素），并要求用户用**完整应用组名**作为确认串复述一次：

```
[WARN] 即将执行不可逆操作：退出应用组
   操作账号：<当前 rtx>           ← 来自 Step 1
   目标应用组：<AppgroupName>     ← 来自参数
   当前角色：<MEMBER / MANAGER>   ← 来自 Step 2
   影响范围：将立即失去该应用组下所有资源访问权，且无法自行回退；
            如需恢复必须重新申请加入并由管理员审批

请回复完整应用组名「<AppgroupName>」以确认执行，回复其他内容即视为取消。
```

- 用户回复**完全等于**应用组名 → 进入 Step 4
- 任何其他回复（包括"是""yes""确认"等模糊表述）→ **终止流程**，反馈"已取消"

**Step 4 — 执行 CLI 调用**
确认通过后才允许调用：
```bash
do-bigdata wedata leave-app-group --appgroup-name "<AppgroupName>" --yes
```
其中 `--yes` 表示已在 Agent 层完成确认，跳过 CLI 的二次交互式确认。**未在 Agent 层完成 SOP 时不允许传 `--yes`**。

### 7.2 CLI 命令与参数

```bash
do-bigdata wedata leave-app-group --appgroup-name "<AppgroupName>" [--yes]
```

| 参数 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `--appgroup-name` | 是 | string | 要退出的应用组名（接口字段 `AppgroupName`） |
| `--yes` / `-y` | 否 | bool | 跳过 CLI 内置的交互式二次确认；**仅在 AI Agent 已完成 SOP 后才允许使用**；人类用户直接使用 CLI 时**不要**加此参数 |

> [WARN] **代理对象即退出对象**：本接口的退出动作作用于 tauth 代理的用户（即配置的运行账号代理的 rtx），即"当前登录用户"。CLI 不提供 `--user` 参数指定他人退出，避免误操作。
>
> ℹ️ **CLI 默认行为（未传 `--yes`）**：
> - **TTY 环境**：打印「操作账号 / 目标应用组 / 不可逆警告」并要求输入完整应用组名进行确认；输入不匹配则中止退出
> - **非 TTY 环境**（管道 / CI）：直接报错退出，强制要求显式 `--yes`，避免被静默执行

### 7.3 CLI 内部前置校验（defense-in-depth）

CLI 在调 `QuitAppgroup` **之前**会先内部调用 `DescribeAppgroup` 校验当前 proxy_user：
- 不在 `Members ∪ Managers` → 抛错退出，**不调 QuitAppgroup**
- 在 `Managers` → 抛错退出，提示"先转让管理员权限"，**不调 QuitAppgroup**

> 这层校验与第 7.1 节 SOP 故意冗余：Agent 走 SOP 是"软"约束，CLI 层校验是"硬"约束，防止脚本 / CI 直接调 CLI 绕过 Agent SOP。

### 7.4 接口返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `Data` | bool | `true` 表示退出成功 |

### 7.5 典型错误处理

| 错误类型 | 处理建议 |
|---------|---------|
| 用户非该应用组成员 | 提示无需退出（可先调用 `describe-app-group` 在 `Members` 中验证） |
| 用户是应用组管理员 / 唯一负责人 | 引导先转让管理员权限再退出（转让操作不在本技能范围） |
| 应用组不存在 / 名称拼写错误 | 提示核对 `AppgroupName` |
| `InvalidParameter.CsParameterValueNullError` | 检查 `AppgroupName` 是否传入 |

## 8. 典型使用场景

**场景一：用户要求查看某个应用组的成员**
1. 询问用户应用组名（`AppgroupName`）
2. 调用 `describe-app-group --appgroup-name <name>`
3. 提取 `Managers` / `Members` 字段以表格形式展示，附带 `Alias` `ClusterName` `BgName` `FullDeptName` 等关键属性

**场景二：用户要求加入某个应用组**
1. 先调用 `describe-app-group` 验证应用组存在
2. 询问用户：申请理由 / 用户类型（OA 账号 vs 平台运行账号）/ 期望角色（强制显式选 `MANAGER` 或 `MEMBER`）
3. 调用 `apply-join-app-group` 提交申请
4. 反馈 `ProcessInstId` 和 `ProcessDetailUrl`，告知用户已进入审批流，可点击链接查看进度

**场景三：用户要求退出某个应用组**（严格按 7.1 节 SOP 4 步执行）
1. **解析当前用户名**：通过 `do-bigdata auth status` 或环境变量 `DO_BIGDATA_USER` 拿到当前 rtx
2. **校验成员身份**：调用 `describe-app-group --appgroup-name <name>`
   - 不在 `Members`/`Managers` → 反馈"无需退出"，结束
   - 在 `Managers` → 反馈"需先转让管理员权限"，结束
3. **强风险提示 + 二次确认**：输出含「操作账号 / 目标应用组 / 当前角色 / 影响范围」的完整提示，要求用户**复述完整应用组名**才视为确认；任何模糊回复都判为取消
4. **确认通过后**才调用 `leave-app-group --appgroup-name <name> --yes`，`Data: true` 表示成功，反馈"已退出 ✓"

## 9. CLI 命令汇总

通过 `do-bigdata wedata` 命令组访问应用组管理技能。CLI 的 `@auth_required` 装饰器自动处理凭证加载（三级 fallback），并基于 CMK 在底层完成 tauth 代理鉴权。

| 命令 | 子技能 | 功能 |
|------|--------|------|
| `describe-app-group` | 查询详情 | 获取应用组完整信息 |
| `apply-join-app-group` | 申请加入 | 提交加入申请，进入审批流 |
| `leave-app-group` | 退出应用组 | 从应用组退出（**不可逆**，需经 7.1 节 SOP 确认） |

**全局可选参数**（所有命令通用，由 `@skill_command` 装饰器自动注入）：

| 参数 | 说明 |
|------|------|
| `--query` | 用户原始问题（AI 自动传入） |
| `--output` | 输出格式（`text` / `json` / `markdown`） |

## 10. 关键参考链接

| 资源 | URL |
|------|-----|
| WeData 平台 | https://wedata.woa.com |
| WeData 应用组管理（控制台） | https://wedata.woa.com/admin/app-group |
| CMK 密钥下载 | https://wedata.woa.com/security/user/keys |

## 11. 实施同步约束（do_cli 仓侧）

> 本技能在 `do_cli` 仓的实际落地路径：`do_cli/sub-cli/WeData/app-group-management/`，由 `cmd/app_group_cmd.py` 注册 3 个 click 命令，底层 `scripts/app_group_client.py` 统一封装 OpenAPI 调用与 tauth 代理鉴权。`scripts/tdw_tauth_authentication.py` 复用自 `sub-cli/WeData/sql-prediagnosis/scripts/`。

修改本技能时必须**同步更新** `do_skills` 与 `do_cli` 两侧：

| 改动场景 | 必须同步的位置 |
|---------|---------------|
| 新增 / 修改命令参数 | ① `cmd/app_group_cmd.py` click options ② `scripts/<x>.py` argparse ③ 本文件第 5/6/7 节「参数」表 |
| 接口返回字段变化 | ① `scripts/app_group_client.py` 函数 docstring ② 本文件第 5/6/7 节「接口返回字段」表 |
| 错误码新增 | ① `app_group_client._ERROR_HINT_RULES` ② 本文件「典型错误处理」表 |
| 凭证传递机制变化 | ① `app_group_cmd._build_runtime_env` 环境变量名 ② `app_group_client.ENV_*` |
| OpenAPI host / path 变更 | 仅改 `app_group_client.py` 常量；本文件**不**落地 host/path |

**version 同步**：本目录 `version` 与 `do_cli/sub-cli/WeData/app-group-management/version` 必须保持一致（当前 `0.3.0`）。

### 11.1 接口与代理鉴权对照（供 do_cli 实现参考）

| 接口 | `is_virtual_user`（CLI 内部参数） | 说明 |
|------|-------------------|------|
| `DescribeAppgroup`   | `False` | 普通 tauth，`proxyUser=None` |
| `ApplyJoinAppgroup`  | **`True`**  | 走 `proxyUser=<rtx>`，对应"平台运行账号代理用户 rtx" |
| `QuitAppgroup`       | **`True`**  | 同上，且退出对象 = `proxyUser` 本人 |

<!-- BIGDATA_QUERY_GUARD -->

## [WARN] --query 参数（强制要求）

每次调用 `do-bigdata` 命令时，**必须**带上 `--query "<用户原始问题>"` 参数，将用户的原始自然语言问题传递给 CLI。

**正确示例**：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util --query "帮我看看 starrocks-prod 最近一小时的 CPU 使用率"
```

**错误示例**（缺少 --query）：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util
```

> `--query` 参数用于使用回传记录用户的真实问题，缺少此参数会导致回传数据中 `user_query` 字段记录为 CLI 命令而非用户原始问题。

**严禁省略 `--query` 参数。**

<!-- /BIGDATA_QUERY_GUARD -->

<!-- BIGDATA_CLI_GUARD -->

## [WARN] CLI 可用性检查（强制前置）

在执行任何 `do-bigdata` 命令之前，**必须**先检查 CLI 是否已安装：

```bash
which do-bigdata
```

### 如果 CLI 不可用，按以下步骤修复：

**第一步**：执行本地热加载脚本安装 CLI：

```bash
python3 tencent-bigdata/hot_reload.py
```

执行后再次检查 `which do-bigdata`。如果 CLI 已可用，跳到「安装后检查」。

**第二步（仅当第一步后 CLI 仍不可用时）**：本地 `hot_reload.py` 可能是远古版本，不包含 CLI 安装逻辑。需要从远程下载最新版本并重新执行：

```bash
# 从 Skills Manager 下载最新的 hot_reload.py，覆盖本地远古版本
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/hot_reload.py/download" -o tencent-bigdata/hot_reload.py

# 同时更新根 SKILL.md
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/SKILL.md/download" -o tencent-bigdata/SKILL.md

# 执行最新的热加载脚本（会自动安装 CLI + 更新所有 Skills）
python3 tencent-bigdata/hot_reload.py
```

### 安装后检查

检查 hot_reload 输出：
- 如果输出包含 `[WARN] 注意: do-bigdata 不在默认 PATH 中`，需要根据输出的 `bin_dir` 执行 `export PATH` 后再调用 `do-bigdata`
- 如果输出 `CLI 可用: <路径>`，则可直接使用 `do-bigdata` 命令

**如果 CLI 不可用，必须先按照上述步骤完成安装，严禁跳过安装步骤直接放弃调用。** 如果安装出现问题，请联系 shimerhe 处理。

<!-- /BIGDATA_CLI_GUARD -->
