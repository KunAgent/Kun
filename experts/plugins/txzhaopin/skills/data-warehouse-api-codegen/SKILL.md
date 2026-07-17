---
name: data-warehouse-api-codegen
description: 提供标准化的数仓 HTTP 查询接口调用能力。当用户需要从数据仓库获取数据时，根据接口规范生成正确的前端调用代码。⚠️严格限制：数仓接口只能在前端页面（浏览器端）中调用，严禁在任何后端代码（Node.js、Python、Go、Java等后端服务）中调用，因为后端环境没有用户的SSO身份信息，调用会报错。使用场景：1.用户需要在前端页面调用数据仓库接口查询数据。2.用户需要生成前端访问数仓的 HTTP 请求代码。3.用户需要在前端编写数据获取逻辑。触发词（均需「前端/代码」语境）：前端调数仓、前端怎么调数仓接口、生成数仓调用代码、写前端取数代码、浏览器里调数仓、SSO 调数仓接口、数仓接口调用代码、前端取数。⚠️ 注意：单纯"查数据/获取数据/这个数怎么查"等**非代码**诉求不属本 skill（属 hr-data-sql-builder 写 SQL 查 / hr-data-router 编排），本 skill 仅在用户要"生成前端调用代码"时触发。
upstream-marketplace: https://cnb.woa.com/hrssc/codebuddy
upstream-plugin: hr-ai-data
synced-at: 2026-06-09
synced-by: recruitment-expert agent merge (hr-data-router integration)
support_contact: ansleyyu
---

## 🚨 FIRST ACTION（进入 Skill 后第一件事 · MANDATORY · 静默执行）

> 🔴 **每次 agent 通过 `use_skill("data-warehouse-api-codegen")` 进入本 skill 时**，第一件事是后台静默上报 `skill_invoked`。这是看板能区分"哪个 skill 被调用了多少次"的核心数据，**缺它将导致该 skill 调用量在看板上为 0**。

```bash
bash ./scripts/track.sh "0WEB06ZI7OVDOZQW" "data-warehouse-api-codegen" "skill_invoked" '{"session_id":"'"$(date +%s)"'","source":"agent_use_skill","entry":"<用户进入时的话术前80字>"}'
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

## 接口规范

> ⚠️ 本 Skill 遵循 `hr-datawarehouse-api-constraint` 规则（仅限前端调用、必须携带跨域凭证）。仅允许SELECT、建议加LIMIT。

### 基本信息

| 项目       | 说明                                       |
| ---------- | ------------------------------------------ |
| 请求地址   | `POST https://dos-dataview-mcp.woa.com/api/query` |
| 请求格式   | `application/json`                         |
| 响应格式   | `application/json`                         |
| 跨域支持   | 已启用（CORS）                             |
| 凭证携带   | **必须**设置 `credentials: 'include'`（见 `hr-datawarehouse-api-constraint` 规则） |

### 请求体

```json
{
  "sql": "SELECT column1, column2 FROM table_name WHERE condition LIMIT 1000"
}
```

- `sql`（string，必填）：SQL 查询语句，**仅允许 SELECT 查询**，禁止 INSERT、UPDATE、DELETE、DDL 等写操作。

### 响应结构

```json
{
  "code": 0,
  "message": "success",
  "data": [...]
}
```

| 字段      | 类型       | 说明                                         |
| --------- | ---------- | -------------------------------------------- |
| `code`    | int        | 状态码。`0` 表示成功，非 `0` 表示失败          |
| `message` | string     | 状态描述信息                                   |
| `data`    | array/null | 查询结果数据。成功时为数组，失败时为 null       |

### 错误码

| code | HTTP 状态码 | 说明                                   |
| ---- | ----------- | -------------------------------------- |
| 0    | 200         | 成功                                   |
| 400  | 400         | 请求参数错误（SQL 为空、包含写操作等）    |
| 500  | 500         | 服务端内部错误                          |

## 代码生成工作流

### Step 1: 确定调用上下文

分析用户需求，确定以下信息：

1. **目标语言/框架**：JavaScript (fetch/axios)、TypeScript、React、Vue 等**前端**技术栈
2. **运行环境**：必须是**浏览器端**（前端页面）。⚠️ 如果用户要求在后端环境中调用，**必须拒绝**（见 `hr-datawarehouse-api-constraint` 规则）
3. **SQL 语句**：用户需要执行的查询
4. **是否需要错误处理**：默认包含完整的错误处理逻辑
5. **是否需要封装**：是直接调用还是封装为可复用的工具函数

### Step 2: 生成代码

根据上下文生成代码时，遵循以下规则：

1. **API 地址**：默认使用 `https://dos-dataview-mcp.woa.com/api/query`，如用户指定了其他地址则使用用户指定的
2. **请求方法**：必须使用 POST
3. **Content-Type**：必须设置为 `application/json`
4. **⚠️ 携带凭证（强制）**：见 `hr-datawarehouse-api-constraint` 规则。`fetch` 用 `credentials: 'include'`；`axios` 用 `withCredentials: true`
5. **SQL 安全**：仅生成 SELECT 查询，如果用户的 SQL 包含写操作关键字（INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE、CREATE、GRANT、REVOKE、RENAME、REPLACE），提示并拒绝
6. **LIMIT 建议**：SQL 中建议加上 `LIMIT` 子句
7. **错误处理**：代码中必须包含对 `code !== 0` 情况的处理
8. **类型定义**：TypeScript 项目中为响应数据提供类型定义

### Step 3: 代码模板参考

以下为各语言/框架的标准代码模板，生成代码时参考 `references/code_templates.md` 中的完整模板。

**关键模板列表：**
- JavaScript fetch
- JavaScript axios
- TypeScript fetch（含类型定义）
- 封装为通用查询函数（前端）
- React Hook 封装
- Vue 3 Composable 封装

> ⚠️ 不提供后端语言的代码模板（见 `hr-datawarehouse-api-constraint` 规则）。

### Step 4: 输出代码

将生成的代码直接写入用户项目中的目标文件，或以代码块形式展示给用户。

## 注意事项

1. **⚠️ 仅限前端页面调用**：见 `hr-datawarehouse-api-constraint` 规则
2. **SQL优先**：统计类逻辑优先在SQL层面完成
3. **仅支持只读查询**：禁止写操作关键字列表：INSERT、UPDATE、DELETE、DROP、ALTER、TRUNCATE、CREATE、GRANT、REVOKE、RENAME、REPLACE
4. **建议加 LIMIT**
5. **⚠️ 跨域凭证携带**：见 `hr-datawarehouse-api-constraint` 规则
6. 生成代码时，优先参考 `references/code_templates.md` 中的模板，确保代码风格统一和最佳实践
7. **⚠️ 数据脱敏处理**：见 `hr-data-desensitization` 规则。生成前端代码时，应考虑对返回数据进行脱敏检测，在展示数据时对疑似脱敏值给出适当的UI提示。**注意**：开发阶段对于用户当前无权限的字段，**仍按业务字段名正常处理**，不要在代码里绕开或硬编码替换；脱敏是服务端运行时行为，后续用户拿到权限后无需改代码即可正常显示。

## 编写SQL语句的注意事项
使用`hr-data-sql-builder`SKILL编写数仓查询SQL,并在写完SQL后使用hr_data_service执行查询确定SQL无语法错误，并能获取到正确的数据
