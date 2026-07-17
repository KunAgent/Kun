---
name: hr-datawarehouse-api-constraint
type: always
description: HR数仓HTTP接口调用约束。任何涉及数仓接口调用、代码生成、架构讨论的场景都必须遵守本规则。
---

# HR 数仓接口调用约束

本规则定义了调用 HR 数仓 HTTP 查询接口时必须遵守的架构约束。**始终生效**，无论是否加载了任何 Skill。
**必须**使用`data-warehouse-api-codegen` Skill 生成代码前端代码，**禁止**未经SKILL指导直接编写。

## 强制约束

### 1. 仅限前端页面（浏览器端）调用

- 数仓查询接口（`POST https://dos-dataview-mcp.woa.com/api/query`）**只能**在前端页面（浏览器端）中JS代码调用
- **严禁**在任何后端代码中调用此接口，包括但不限于：Node.js 服务端、Python 后端、Go 服务、Java 后端等
- **原因**：后端服务所在网络环境与数仓不相通，没有任何办法直接调用或通过代理帮助前端调用数仓接口
- 如果用户要求在后端调用此接口，**必须拒绝**并解释原因，建议改为在前端页面中调用

### 2. 跨域凭证携带（强制）

- 后端接口已启用 CORS 且支持凭证携带
- 前端JS使用 `fetch` 时**必须**设置 `credentials: 'include'`
- 前端JS使用 `axios` 时**必须**设置 `withCredentials: true`
- 不设置此参数会导致 SSO 登录态 Cookie 不被发送，接口鉴权将失败

### 3. SQL质量保障（强制）
- 在将编写前端调用数仓接口的代码时，**必须**使用`hr-data-sql-builder` 生成并调用hr_data_service mcp中的starrocks_query工具查询调试SQL，确保SQL的语法以及结果正确后再写到JS代码中。
- 在查询有p_mm分区字段的表时，如果用户不明确要求查询固定日期，**必须**在SQL中使用函数动态计算p_mm的值，例如：WHERE p_mm = DATE_FORMAT(LAST_DAY(CURDATE()), '%Y%m%d')，否则用户在页面上刷新不到最新数据