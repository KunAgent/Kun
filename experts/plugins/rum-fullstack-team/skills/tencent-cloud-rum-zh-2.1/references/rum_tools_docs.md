# 腾讯云 RUM MCP 工具参数参考

## MCP Server 配置

- **URL**：`https://app.rumt-zh.com/sse`
- **传输协议**：`sse`
- **鉴权**：通过 HTTP Headers 传入 `SecretId` 与 `SecretKey`（在此处获取：[腾讯云 API 密钥管理](https://console.cloud.tencent.com/cam/capi)）

```json
{
  "mcpServers": {
    "rum": {
      "transportType": "sse",
      "url": "https://app.rumt-zh.com/sse",
      "headers": {
        "SecretId": "<YOUR_SECRET_ID>",
        "SecretKey": "<YOUR_SECRET_KEY>"
      }
    }
  }
}
```

---

## 工具 1：QueryRumWebProjects

### 功能说明
查询 RUM-WEB 应用列表。最多返回 50 条。若应用超过 50 个，可通过 ProjectName 或 ProjectId 参数做过滤。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `ProjectId` | string | 否 | 应用 ID，数字字符串，例如 "123456" |
| `ProjectName` | string | 否 | 应用名，精确匹配 |
| `ProjectNameLike` | string | 否 | 模糊搜索，查找包含指定字符串的所有应用。不能与 ProjectName 同时使用 |

### 使用场景
- 用户只给了 ProjectId —— 先用 `QueryRumWebProjects({ProjectId: "<ID>"})` 校验存在性
- 用户不知道自己的 ProjectId —— 不带参数调一次拿全量列表
- 查看当前账号下所有 RUM-WEB 应用
- 用户给出应用名 —— 先尝试精确匹配（`ProjectName`），再模糊匹配（`ProjectNameLike`）

### 调用要点
- ProjectId 必须是纯数字字符串（如 `"123456"`），非数字格式要先向用户校验
- 精确匹配无结果时，改用 `ProjectNameLike` 模糊搜索
- 模糊搜索仍无结果时，不带参数调用一次，拿全量列表做对比
- 全量返回 = 50 条 → 说明已达到上限，需要提示用户提供应用名关键词
- 其他工具报 "无权限" → 先回到这里用 `ProjectId` 校验，可能填错了 ID
- 完整的四场景查询流程见 `SKILL.md` 的「应用信息查询规则」

---

## 工具 2：QueryRumWebMetric

### 功能说明
查询 RUM-WEB 指标数据。支持网络指标（请求数、API 平均延迟、状态码错误率、retcode 错误率）、JS 错误、资源加载异常、PV、UV、页面性能以及静态资源指标。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `ProjectId` | string | ✅ 必填 | 应用 ID |
| `Metric` | string(枚举) | ✅ 必填 | 指标类型：`network`/`exception`/`pv`/`uv`/`performance`/`resource` |
| `Limit` | number | ✅ 必填 | 返回条数，**推荐默认 100**，最大 1000 |
| `StartTime` | number | 否 | 开始时间戳（秒），默认 12 小时前 |
| `EndTime` | number | 否 | 结束时间戳（秒），默认当前时间 |
| `Region` | string | 否 | 地域：`ap-guangzhou`（默认）/`ap-singapore`/`na-siliconvalley` |
| `Filters` | array | 否 | 过滤条件数组 |
| `GroupBy` | array | 否 | 聚合分组字段（单字段也必须是数组） |

### Metric 参数选择指南

| 用户诉求 | Metric 值 | 备注 |
|---------|----------|------|
| 接口请求数、延迟、错误率 | `network` | — |
| HTTP 状态码、retcode | `network` | — |
| 网络错误 | `network` | 不是 `exception` |
| 所有异常类型 | `exception` | 不加 level 过滤 |
| JS 错误 | `exception` | 过滤 level=4 |
| JS + Promise 错误 | `exception` | 过滤 level in ('4','8') |
| 页面性能（LCP/FCP/TTFB 等） | `performance` | 默认使用 LCP |
| PV | `pv` | — |
| UV | `uv` | — |
| 静态资源加载 | `resource` | 不支持 `from` 过滤 |

### Filters 过滤条件

**支持字段**：`brand`、`browser`、`device`、`env`、`error_msg`（仅 exception）、`ext1`~`ext10`、`from`（resource 不支持）、`is_abroad`、`is_err`、`isp`、`level`（仅 exception）、`method`、`net_type`、`os`、`platform`、`region`、`ret`、`status`、`url`、`version`

**操作符**：`=`（等于）、`!=`（不等于）、`like`（模糊匹配）、`not like`（模糊不匹配）

**注意**：`is_err` 仅过滤 retcode 错误，通常无需使用。

Filter 示例：
```json
[
    {"Key": "env", "Operator": "=", "Value": "production"},
    {"Key": "version", "Operator": "=", "Value": "2.0.0"},
    {"Key": "level", "Operator": "in", "Value": "('4','8')"}
]
```

### GroupBy 聚合维度

**可用值**：`brand`、`browser`、`device`、`env`、`ext1`~`ext10`、`from`、`is_abroad`、`is_err`、`isp`、`method`、`net_type`、`os`、`platform`、`region`、`ret`、`status`、`url`、`version`、`time(1m)`、`time(5m)`、`time(1h)`、`time(1d)`

**关键要点**：
- 单字段也必须以数组传入，如 `["from"]`
- **多维度分析必须拆分成多次查询 —— 绝不能在一次请求中 GroupBy 多个维度**
- 指标查询默认按数据量排序；若要按指标值排序，请在拿到结果后手动排序

### 关键：`from` vs `url` vs `originFrom` 在查询中的语义

在 RUM 查询工具中，这几个 URL 相关字段含义不同：

| 字段 | 查询上下文中的含义 | 用法 |
|------|------------------|------|
| `from` | **页面 URL** —— 事件发生所在的页面（会被 SDK 的 `urlHandler` 处理过） | 在 `GroupBy: ["from"]` 或 `Filters` 中使用，按页面维度分析。适用于：performance、network、exception、pv/uv 指标 |
| `url` | **API/资源 URL** —— 被监控的网络请求或资源地址 | 在 `GroupBy: ["url"]` 或 `Filters` 中使用，分析具体的接口或资源。适用于：network 与 resource 指标。**注意**：`resource` 指标不支持 `from` 过滤 —— 请改用 `QueryResourceByPage` 工具 |
| `originFrom` | **原始页面 URL**（未经处理，来自浏览器地址栏） | 在指标查询中不可用作 GroupBy/Filter 维度。仅在单条日志详情中可见（通过 `QueryRumWebLog`）。仅 Web 端有值；RN/小程序中为空 |

**常见误用规避**：
- 不要把 `from`（页面）与 `url`（接口/资源）混淆 —— 它们回答的是不同问题
- 用户问"哪个页面错误最多"→ 用 `GroupBy: ["from"]`
- 用户问"哪个接口最慢"→ 用 `GroupBy: ["url"]`
- 用户在日志详情里问的"原始页面 URL"→ 那是 `originFrom`

### 常见响应字段

**network 类型**：
- `allCount` - 总请求数
- `duration_avg` - 平均延迟
- `error_rate_percent` - 状态码错误率
- `retcode_error_percent` - Retcode 错误率

**performance 类型**：
- `lcp_avg` - LCP 平均值
- `fcp_avg` - FCP 平均值
- `dns_avg` - DNS 查询耗时
- `tcp_avg` - TCP 建连耗时
- `ssl_avg` - SSL 握手耗时
- `ttfb_avg` - TTFB 耗时
- `content_download_avg` - 内容下载耗时
- `dom_parse_avg` - DOM 解析耗时
- `resource_download_avg` - 资源下载耗时
- `fmp_avg` - 首次有效绘制耗时

**resource 类型**：
- `allCount` - 总请求数
- `duration_avg` - 平均加载耗时
- `error_rate_percent` - 加载错误率
- `connect_time_avg` - 建连耗时
- `domain_lookup_avg` - 域名解析耗时
- `transfer_size_avg` - 传输大小（负值表示跨域导致无法获取大小）

**exception 类型**：
- `allCount` - 异常总数
- `affectCount` - 影响用户数
- `error_rate_percent` - 错误率

---

## 工具 3：QueryRumWebLog

### 功能说明
查询 RUM-WEB 全量日志，支持丰富过滤与分页。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `ProjectId` | string | ✅ 必填 | 应用 ID |
| `Limit` | number | ✅ 必填 | 返回条数，**推荐默认 10**，最大 1000 |
| `StartTime` | number | 否 | 开始时间戳（秒），默认 2 小时前 |
| `EndTime` | number | 否 | 结束时间戳（秒），默认当前时间 |
| `Region` | string | 否 | 地域，默认 `ap-guangzhou` |
| `Filters` | array | 否 | 过滤条件数组（**必须是 JSON 对象，不能是字符串**） |
| `RespFields` | array | 否 | 指定返回字段；不传则全量返回（**请合理使用，避免响应过大**） |
| `LastRowId` | number | 否 | 分页使用 —— 上次响应的最后一个 row_id |
| `LastTime` | number | 否 | 分页使用 —— 上次响应的最后一个 ts |

### Filters 过滤条件

**支持字段**：`aid`、`brand`、`browser`、`city`、`country`、`device`、`env`、`errorMsg`、`ext1`~`ext10`、`from`、`ip`、`isAbroad`、`isp`、`level`、`method`、`msg`、`netType`、`os`、`platform`、`province`、`region`、`sessionId`、`sr`、`trace`、`ts`、`uin`、`userAgent`、`version`、`vp`

**操作符**：`eq`（等于）、`neq`（不等于）、`like`（模糊匹配）、`nlike`（模糊不匹配）、`in`

**关键要点**：
- 日志工具的操作符（`eq`/`neq`/`like`/`nlike`/`in`）**与指标工具的操作符不同**（`=`/`!=`/`like`/`not like`）
- `level` 字段**仅支持** `eq`、`neq`、`in` 操作符
- 大部分信息（包括 url）都在 `msg` 字段中 —— 查询 URL 请用 `msg` + `like`
- 地域字段使用 `city` 和 `country`（不是 `region`）

### RespFields 可选字段

`aid`、`brand`、`browser`、`city`、`country`、`device`、`env`、`errorMsg`、`ext1`~`ext10`、`from`、`ip`、`isAbroad`、`isp`、`level`、`method`、`msg`、`netType`、`os`、`platform`、`province`、`region`、`sessionId`、`sr`、`trace`、`ts`、`uin`、`userAgent`、`version`、`vp`

---

## 工具 4：QueryResourceByPage

### 功能说明
按页面查询资源指标。Filter 仅支持 `from` 字段。若需其他过滤或 GroupBy，请改用 `QueryRumWebMetric`。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `ProjectId` | string | ✅ 必填 | 应用 ID |
| `From` | string | ✅ 必填 | 要查询的页面 URL |
| `StartTime` | number | 否 | 开始时间戳（秒），默认 12 小时前 |
| `EndTime` | number | 否 | 结束时间戳（秒），默认当前时间 |

### 响应指标
- `duration_avg` - 资源平均加载耗时
- `connect_time_avg` - 建连耗时
- `domain_lookup_avg` - 域名解析耗时
- `transfer_size_avg` - 传输大小（**负值表示跨域无法获取**；建议在响应头中配置 `Timing-Allow-Origin`）
- `error_rate_percent` - 资源加载错误率

---

## 工具 5：QueryApmLinkId

### 功能说明
获取 RUM 应用关联的 APM 应用 ID，用于 RUM-APM 链路串联。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|-----|------|
| `ProjectId` | string | ✅ 必填 | RUM 应用 ID |
| `Region` | string | 否 | 地域，默认 `ap-guangzhou` |

### 使用场景
当日志的 `trace` 字段非空时，调用该工具获取关联的 APM 项目 ID，再借助 APM 工具做深入的后端链路分析。
