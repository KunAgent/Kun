# RUM-WEB 问题分析流程

本文档包含四大分析流程。AI 应根据用户诉求匹配对应流程。

---

## 流程 1：TOP 异常分析

### Step 1：获取 RUM 应用信息
- **目标**：确定要分析的 RUM 应用 ID
- **操作**：参照 SKILL.md 中的"应用信息查询规则"

### Step 2：查询异常指标概览（所有类型）
- **目标**：了解整体异常分布
- **操作**：调用 `QueryRumWebMetric`
  - `Metric`：`exception`
  - `GroupBy`：`["level"]`
  - `Limit`：`100`
  - Filters 中不加 level 过滤（查询全部异常类型）
- **分析**：按类型（level）统计异常数量，识别哪些类型最严重

### Step 3：分析 TOP JS/Promise 错误
- **目标**：找出最频繁的 JS/Promise 错误
- **操作**：调用 `QueryRumWebMetric`
  - `Metric`：`exception`
  - `Filters`：`[{"Key":"level","Operator":"in","Value":"('4','8')"}]`
  - `GroupBy`：`["error_msg"]`
  - `Limit`：`100`
- **输出**：按错误信息分组的 TOP JS/Promise 错误（次数、影响用户、错误率）

### Step 4：分析其他重要异常类型
- **目标**：针对 Step 2 中发现的其他高频异常深入分析
- **操作**：对每种值得关注的异常（如资源加载错误），调用 `QueryRumWebMetric`
  - `Metric`：`exception`
  - `Filters`：设置对应的 level 值（如 level=32 代表脚本加载错误）
  - `GroupBy`：选择合适字段（如 `["from"]`）
  - `Limit`：`100`

### Step 5：分析异常分布
- **目标**：了解 TOP 异常的分布特征
- **操作**：对每个 TOP 异常做多维拆解：
  - 按页面：`GroupBy`：`["from"]`
  - 按平台：`GroupBy`：`["platform"]`
  - 按版本：`GroupBy`：`["version"]`
- **注意**：每个维度分别查询 —— 绝不把多维合并到一次查询

### Step 6：查询具体异常日志
- **目标**：获取 TOP 异常的详细日志以分析根因
- **操作**：对每个 TOP 异常调用 `QueryRumWebLog`
  - `Filters`：根据具体异常设置条件
    - 对应的 level 类型
    - JS 错误可用 `msg` + `like` 匹配 error_msg
  - `Limit`：`10`（代表性样本）
  - `RespFields`：按分析需要设置
- **分析**：查看完整错误栈、发生场景、用户环境

### Step 7：APM 关联分析（若适用）
- **触发条件**：异常与 API 相关，且日志 `trace` 字段非空
- **操作**：
  1. 调用 `QueryApmLinkId` 获取关联的 APM 应用 ID
  2. 按 apm_analysis.md 中的"APM Trace 分析步骤"继续执行

### Step 8：输出分析结论
- **输出内容**：
  1. **TOP 异常列表**：按严重程度排序（次数、影响用户、错误率）
  2. **异常类型分布**：各类型占比与趋势
  3. **每个 TOP 异常的根因分析**：
     - 错误描述与信息
     - 受影响最大的页面
     - 受影响最大的用户群体（平台、浏览器、版本等）
     - 典型发生场景
     - 可能的根本原因
  4. **优化建议**：针对每个 TOP 异常给出具体修复建议

---

## 流程 2：TOP 页面性能分析

### Step 1：获取 RUM 应用信息
- **目标**：确定要分析的 RUM 应用 ID

### Step 2：按页面查询 LCP 性能指标
- **目标**：识别性能最差的 TOP 页面
- **操作**：调用 `QueryRumWebMetric`
  - `Metric`：`performance`
  - `GroupBy`：`["from"]`（按页面 URL 分组）
  - `Limit`：`100`
- **分析重点**：
  - 结合 LCP 值与请求数，找出 LCP 最高且影响面最大的页面
  - LCP（Largest Contentful Paint）是页面性能的关键指标
  - 记录 TOP 5-10 性能最差的页面

### Step 3：分析每个 TOP 页面的性能明细
- **目标**：了解每个 TOP 页面的性能耗时分解
- **操作**：对每个 TOP 页面调用 `QueryRumWebMetric`
  - `Metric`：`performance`
  - `Filters`：`[{"Key":"from","Operator":"=","Value":"<具体页面 URL>"}]`
  - `Limit`：`100`
  - 不使用 GroupBy（获取整体指标）
- **关键指标**：
  - `lcp_avg`：LCP 平均值
  - `fcp_avg`：FCP 平均值
  - `dns_avg`：DNS 查询耗时
  - `tcp_avg`：TCP 建连耗时
  - `ssl_avg`：SSL 握手耗时
  - `ttfb_avg`：TTFB 耗时
  - `content_download_avg`：内容下载耗时
  - `dom_parse_avg`：DOM 解析耗时
  - `resource_download_avg`：资源下载耗时
  - `fmp_avg`：首次有效绘制耗时

### Step 4：诊断性能瓶颈类型
- **目标**：判断每个 TOP 页面的主要性能瓶颈
- **分析逻辑**：
  - **网络层慢**：DNS、TCP、SSL 耗时偏高 → 执行 Step 5（地区 & 运营商分析）
  - **资源加载慢**：资源下载耗时偏高 → 执行 Step 6（资源分析）
  - **内容渲染慢**：DOM 解析、内容下载耗时偏高 → 跳至 Step 8 给出建议

### Step 5：网络层分析（DNS/TCP/SSL 慢时）
- **目标**：判断是否是特定地区或运营商造成的网络慢
- **操作 A - 按地区**：
  - `Metric`：`performance`
  - `Filters`：`[{"Key":"from","Operator":"=","Value":"<具体页面 URL>"}]`
  - `GroupBy`：`["region"]`
  - `Limit`：`100`
- **操作 B - 按运营商**：
  - `GroupBy`：`["isp"]`
  - `Limit`：`100`
- **分析重点**：识别 DNS/TCP/SSL 耗时异常高的地区/运营商

### Step 6：资源加载分析（资源下载慢时）
- **目标**：找到具体加载慢的资源
- **操作**：调用 `QueryResourceByPage`
  - `ProjectId`：应用 ID
  - `From`：具体页面 URL
  - 时间范围：与前面的查询保持一致
- **分析重点**：
  - `duration_avg`：资源平均加载耗时
  - `connect_time_avg`：建连耗时
  - `domain_lookup_avg`：域名解析耗时
  - `transfer_size_avg`：传输大小（负值表示跨域无法获取；建议配置 `Timing-Allow-Origin`）
  - `error_rate_percent`：资源加载错误率
  - 按 duration 降序排序找出 TOP 慢资源

### Step 7：慢资源的多维分析
- **目标**：分析慢资源是否与地区、运营商等相关
- **操作 A - 按地区**：`GroupBy`：`["region"]`
- **操作 B - 按运营商**：`GroupBy`：`["isp"]`
- **操作 C - 按平台**：`GroupBy`：`["platform"]`
- **注意**：每个维度单独查询

### Step 8：输出综合分析报告
- **输出内容**：
  1. **TOP 性能问题页面**（按 LCP 降序）
     - 页面 URL、LCP 均值、耗时分解
  2. **每个 TOP 页面的性能瓶颈诊断**
     - 主要瓶颈类型（网络/资源/渲染）
     - 具体瓶颈指标与数值
     - 网络问题：受影响的地区与运营商
     - 资源问题：慢资源列表与耗时
  3. **性能问题分布**
     - 平台分布（iOS/Android/PC）
     - 浏览器分布
     - 版本分布
     - 地区分布
  4. **优化建议**（按瓶颈类型）
     - **DNS**：DNS 预解析、CDN 加速
     - **TCP/SSL**：启用 HTTP/2、连接复用、优化 SSL 配置
     - **资源加载**：压缩资源、使用 CDN、懒加载、优化大小
     - **DOM 渲染**：降低 DOM 深度、优化关键渲染路径、代码分割
     - **内容下载**：启用 Gzip/Brotli、优化首屏资源
     - **地区**：为慢地区新增 CDN 边缘节点、优化路由
     - **运营商**：多线路接入、与具体运营商协同

---

## 流程 3：TOP 接口性能与稳定性分析

### Step 1：获取 RUM 应用信息
- **目标**：确定要分析的 RUM 应用 ID

### Step 2：查询接口整体指标
- **目标**：了解接口请求整体健康度
- **操作**：调用 `QueryRumWebMetric`
  - `Metric`：`network`
  - 不使用 GroupBy（获取整体指标）
  - `Limit`：`100`
- **分析重点**：
  - `allCount`：接口请求总数
  - `duration_avg`：接口平均延迟
  - `error_rate_percent`：状态码错误率
  - `retcode_error_percent`：Retcode 错误率
  - 初步判断：性能问题 vs 稳定性问题

### Step 3：分析 TOP 慢接口（性能维度）
- **目标**：找出延迟最高的接口
- **操作**：调用 `QueryRumWebMetric`
  - `Metric`：`network`
  - `GroupBy`：`["url"]`（按接口 URL 分组）
  - `Limit`：`100`
- **分析**：按 `duration_avg` 排序，识别 TOP 5-10 最慢接口的 URL、延迟、次数、错误率

### Step 4：分析 TOP 错误接口（稳定性维度）
- **操作 A - 按错误率**：
  - `Metric`：`network`
  - `GroupBy`：`["url"]`
  - `Limit`：`100`
- **操作 B - 按状态码**：
  - `Metric`：`network`
  - `GroupBy`：`["url", "status"]`
  - `Limit`：`100`
- **分析**：识别高错误率接口，分析 HTTP 状态码分布（4xx、5xx），区分状态码错误与 retcode 错误

### Step 5：TOP 接口的多维分析
- **目标**：从多维度分布定位根因
- **操作**：对每个 TOP 问题接口：
  - **A. 按地区**：`GroupBy`：`["region"]`
  - **B. 按运营商**：`GroupBy`：`["isp"]`
  - **C. 按平台**：`GroupBy`：`["platform"]`
  - **D. 按版本**：`GroupBy`：`["version"]`
  - **E. 按来源页面**：`GroupBy`：`["from"]`
- **注意**：每个维度单独查询

### Step 6：分析 Retcode 业务错误（若存在）
- **目标**：深挖业务返回码错误
- **操作**：对 retcode 错误率高的接口：
  - `Metric`：`network`
  - `Filters`：`[{"Key":"url","Operator":"like","Value":"<具体接口 URL>"},{"Key":"is_err","Operator":"=","Value":"1"}]`
  - `GroupBy`：`["ret"]`（按返回码分组）
  - `Limit`：`100`
- **分析**：识别具体错误码，统计次数与占比

### Step 7：查询 TOP 接口详细日志
- **目标**：获取问题接口的详细请求日志
- **操作**：对每个 TOP 问题接口调用 `QueryRumWebLog`
  - `Filters`：
    - 按接口：`[{"Key":"msg","Operator":"like","Value":"<接口 URL>"}]`
    - 分析错误时，再加 level 过滤：`[{"Key":"level","Operator":"in","Value":"('16','1024')"}]`（AJAX_ERROR 和 RET_ERROR）
  - `Limit`：`10`
  - `RespFields`：按分析需要
- **分析**：查看错误栈、请求参数、用户环境、网络状态；检查 `trace` 字段以决定是否关联 APM

### Step 8：APM 深度分析（若适用）
- **触发条件**：日志 `trace` 字段非空
- **操作**：
  1. 调用 `QueryApmLinkId` 获取关联的 APM 应用 ID
  2. 按 apm_analysis.md 中的"APM Trace 分析步骤"继续执行

### Step 9：输出综合分析报告
- **输出内容**：
  1. **TOP 接口问题列表**
     - **TOP 慢接口**（按平均延迟降序）：URL、平均延迟、次数、错误率
     - **TOP 错误接口**（按错误率/次数降序）：URL、状态码错误率、retcode 错误率、主要错误码、次数
  2. **每个 TOP 接口的根因分析**
     - 性能根因
     - 稳定性根因：错误类型、具体错误码、发生场景、后端服务错误、受影响用户特征
  3. **问题分布**：地区、运营商、平台、版本、页面分布
  4. **优化建议**
     - **接口延迟**：后端优化、请求合并、缓存、CDN、慢地区网络路由优化
     - **状态码错误**：4xx —— 检查前端校验与权限；5xx —— 后端稳定性与容量；网络错误 —— 调整超时与重试
     - **Retcode 业务错误**：加强前端校验、优化用户引导、完善业务逻辑、提供更友好的错误提示
     - **地区/运营商**：部署边缘节点、多线路接入、智能路由

---

## 流程 4：TOP 资源加载慢分析

### Step 1：获取 RUM 应用信息
- **目标**：确定要分析的 RUM 应用 ID

### Step 2：查询静态资源整体指标
- **目标**：了解静态资源加载整体健康度
- **操作**：调用 `QueryRumWebMetric`
  - `Metric`：`resource`
  - `GroupBy`：`["url"]`（按资源 URL 分组）
  - `Limit`：`100`
- **分析重点**：
  - `allCount`：资源请求总数
  - `duration_avg`：资源平均加载耗时
  - `error_rate_percent`：资源加载错误率
  - 结合 `duration_avg` 与 `allCount` 排序，识别影响面大的慢资源

### Step 3：识别 TOP 慢资源
- **目标**：找出加载耗时最高的资源
- **输出**：
  - TOP 10-20 最慢资源的 URL
  - 每个资源：平均耗时、次数、错误率、建连耗时、域名解析耗时、传输大小

### Step 4：TOP 慢资源的多维分析
- **目标**：从多维分布定位根因
- **操作**：对每个 TOP 慢资源：
  - **A. 按地区**：
    - `Metric`：`resource`
    - `Filters`：`[{"Key":"url","Operator":"=","Value":"<具体资源 URL>"}]`
    - `GroupBy`：`["region"]`
    - `Limit`：`100`
  - **B. 按运营商**：`GroupBy`：`["isp"]`
  - **C. 按平台**：`GroupBy`：`["platform"]`
  - **D. 按网络类型**：`GroupBy`：`["net_type"]`
- **注意**：每个维度单独查询

### Step 5：诊断慢资源的具体瓶颈
- **分析逻辑**（结合 Step 3 与 Step 4 的数据）：
  - **网络层慢**：
    - `connect_time_avg` 偏高 → TCP/SSL 握手慢
    - `domain_lookup_avg` 偏高 → DNS 解析慢
    - 根因：网络质量问题、特定地区/运营商问题
  - **传输层慢**：
    - `duration_avg` 偏高但 `connect_time_avg` 与 `domain_lookup_avg` 正常
    - `transfer_size_avg` 很大（注意：负值表示跨域无法获取）
    - 根因：资源体积过大、带宽不足、CDN 未部署或配置错误

### Step 6：查询慢资源日志（可选）
- **目标**：获取具体资源加载日志做异常分析
- **操作**：调用 `QueryRumWebLog`
  - `Filters`：
    - `[{"Key":"msg","Operator":"like","Value":"<资源 URL>"}]`
    - 慢资源请求：`[{"Key":"level","Operator":"eq","Value":"1029"}]`（SLOW_ASSET_REQUEST）
    - 资源错误：`[{"Key":"level","Operator":"eq","Value":"1028"}]`（ASSERT_REQUEST）
  - `Limit`：`10`
  - `RespFields`：按分析需要
- **分析**：资源加载失败场景、用户环境、网络状态、具体错误信息

### Step 7：输出综合分析报告
- **输出内容**：
  1. **TOP 慢资源**（按平均耗时降序）
     - 资源 URL、平均加载耗时、次数、传输大小、建连耗时、域名解析耗时、错误率
  2. **每个 TOP 慢资源的根因分析**
  3. **严重程度评估**：发生次数、对整体页面性能的影响
  4. **优化建议**（按问题类型）
     - **网络层**：DNS 预解析（`<link rel="dns-prefetch">`）、HTTP/2 或 HTTP/3、优化 SSL、为慢地区增加 CDN 边缘节点
     - **传输层**：压缩（Gzip/Brotli）、图片优化（WebP、懒加载、响应式图片）、代码分割与按需加载、CDN 加速、资源合并（CSS Sprites、内联小资源）
     - **跨域配置**：在资源服务器响应头中添加 `Timing-Allow-Origin: *`，核实资源域名配置
     - **缓存**：合理设置缓存策略（Cache-Control）、浏览器缓存与 Service Worker、CDN 缓存配置
     - **地区/运营商**：为慢地区部署更多 CDN 边缘节点、多线路接入、智能 DNS 解析

---

## 常用查询示例

### 列出应用

```json
// 查看全部应用（最多返回 50 条）
Tool: QueryRumWebProjects
Params: {}

// 按 ProjectId 校验存在性（场景 A）
Tool: QueryRumWebProjects
Params: {"ProjectId": "123456"}

// 按应用名精确匹配（场景 B 第 1 步）
Tool: QueryRumWebProjects
Params: {"ProjectName": "my-app"}

// 按名称模糊搜索（场景 B 第 2 步）
Tool: QueryRumWebProjects
Params: {"ProjectNameLike": "my-app"}
```

### 网络请求指标

```json
// 接口请求概览
Tool: QueryRumWebMetric
Params: {
    "ProjectId": "123456",
    "Metric": "network",
    "Limit": 100
}

// 按接口 URL 分组做延迟分析
Tool: QueryRumWebMetric
Params: {
    "ProjectId": "123456",
    "Metric": "network",
    "GroupBy": ["url"],
    "Limit": 100
}
```

### 异常查询

```json
// 所有异常类型概览
Tool: QueryRumWebMetric
Params: {
    "ProjectId": "123456",
    "Metric": "exception",
    "GroupBy": ["level"],
    "Limit": 100
}

// TOP JS/Promise 错误
Tool: QueryRumWebMetric
Params: {
    "ProjectId": "123456",
    "Metric": "exception",
    "Filters": [{"Key": "level", "Operator": "in", "Value": "('4','8')"}],
    "GroupBy": ["error_msg"],
    "Limit": 100
}
```

### 页面性能查询

```json
// 按页面查询性能
Tool: QueryRumWebMetric
Params: {
    "ProjectId": "123456",
    "Metric": "performance",
    "GroupBy": ["from"],
    "Limit": 100
}
```

### 日志查询

```json
// 错误日志
Tool: QueryRumWebLog
Params: {
    "ProjectId": "123456",
    "Limit": 10,
    "Filters": [
        {"Key": "level", "Operator": "in", "Value": "('4','8','16','32')"}
    ],
    "RespFields": ["ts", "level", "errorMsg", "from", "msg", "version", "os", "trace"]
}

// 按 URL 查询接口相关日志
Tool: QueryRumWebLog
Params: {
    "ProjectId": "123456",
    "Limit": 10,
    "Filters": [
        {"Key": "msg", "Operator": "like", "Value": "api.example.com"}
    ],
    "RespFields": ["ts", "level", "msg", "from", "trace"]
}

// 查询某个用户的日志
Tool: QueryRumWebLog
Params: {
    "ProjectId": "123456",
    "Limit": 50,
    "Filters": [
        {"Key": "uin", "Operator": "eq", "Value": "user_12345"}
    ]
}
```

### 按页面查询资源

```json
Tool: QueryResourceByPage
Params: {
    "ProjectId": "123456",
    "From": "https://example.com/home"
}
```

### APM 关联

```json
Tool: QueryApmLinkId
Params: {
    "ProjectId": "123456"
}
```
