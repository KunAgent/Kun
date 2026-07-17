# APM 关联分析指南

## 触发条件

当查询到的日志与 API 请求相关，且 `trace` 字段非空时，可关联 APM 数据：
1. 调用 `QueryApmLinkId` 获取关联的 APM 项目 ID
2. 按下方 "APM Trace 分析步骤" 执行

---

## APM Trace 分析步骤

1. 使用 `DescribeGeneralSpanTree` 查询该 trace_id 的**错误 span**
2. 使用 `DescribeGeneralSpanTree` 查询该 trace_id 的**慢 span**
3. 若慢 span 中包含 LogTopicID，使用 `DescribeGeneralSpanTree` 查询该 trace_id 的**日志信息**。若无 LogTopicID，则跳至下一步
4. 查阅 APM-Span 属性定义，并从 trace 中提取关键 Span 属性：
   - 若存在 DB 与 CVM 相关属性，提取 `db.ip` 或 `cvm.instance.id` 中的 IP 部分，使用 `GetMonitorData` 查询相关实例的监控指标
   - 若存在 TKE 相关属性，提取 `k8s.cluster.id` 与 `k8s.node.ip`，使用 `GetMonitorData` 查询 K8sPodRateCpuCoreUsedNode 与 K8sPodRateMemUsageNode 指标
5. 综合分析：
   - **错误 span**：关注以 `error` 与 `exception` 为前缀的属性；分析根因 span、错误内容、出错机器、出错原因
   - **慢 span**：分析耗时发生在何处（某个 span 处理过长、span 内部报错、span 调用间隔过大等）
   - 判断问题是否与实例监控指标存在关联

---

## DescribeGeneralSpanTree 参数指南

### 输入规则

- 根据应用状态选择 `span_status`：告警用 SLOW，异常用 ERROR
- **不要查询完整 trace 数据** —— 不要把 `span_status` 设为 UNSET
  - 原因：完整 trace 数据过大，会撑爆上下文、影响分析
- 根据用户问题选择 `scene_type`：错误用 ERR、数据库用 SQL、消息队列用 MQ、其他用 NORMAL
- 若没有具体关注目标，不要设置 `scene_type`
- 当 `scene_type` 不为 NORMAL 时，`object` 是必填（指定关注目标）
- 使用 `DescribeGeneralSpanTree` 时，时间范围可在目标请求时间前后各扩展 1 小时

### 使用场景

| 场景 | 输入 | 输出 |
|------|------|------|
| 查询应用详情 | 必填参数、地域、应用名 | 应用中一条随机的错误/慢 trace |
| 查询接口详情 | 必填参数、地域、业务系统 ID、应用名、接口名 | 接口中一条错误/慢 trace |
| 分析特定错误类型/DB/MQ | 必填参数、地域、维度信息、scene_type、object | 指定错误/异常的 trace 信息（ERROR 和 SLOW 需分别提交） |
| 查询 trace 日志 | 必填参数、地域、trace_id、span_status=LOG、object=LogTopicID | 该 trace 的日志信息（同时需要 trace_id 与 LogTopicID） |

---

## DescribeSpanTagList 参数指南

| 场景 | 过滤 Key |
|------|---------|
| 按 HTTP 信息查询 | `http.route`（请求路径）、`http.request.method`（方法）、`http.response.status_code`（状态码） |
| 按 RPC 信息查询 | `rpc.method`（被调方法）、`rpc.service`（被调服务）、`network.peer.address`（对端地址）、`network.peer.port`（对端端口） |

---

## 日志 Level 枚举值

| 值 | 说明 |
|----|------|
| `1` | API_RESPONSE - 所有 API 请求（白名单或默认上报） |
| `2` | INFO - 一般信息日志 |
| `4` | ERROR - 错误日志 |
| `8` | PROMISE_ERROR - Promise 错误 |
| `16` | AJAX_ERROR - AJAX 错误 |
| `32` | SCRIPT_ERROR - JS 加载错误 |
| `64` | IMAGE_ERROR - 图片加载错误 |
| `128` | CSS_ERROR - CSS 加载错误 |
| `256` | CONSOLE_ERROR - 控制台错误 |
| `512` | MEDIA_ERROR - 多媒体资源错误 |
| `1024` | RET_ERROR - 接口返回码错误 |
| `1025` | PAGE_LOAD - 页面加载 |
| `1026` | SLOW_PAGE_LOAD - 页面加载慢 |
| `1027` | SLOW_NET_REQUEST - 网络请求慢 |
| `1028` | ASSERT_REQUEST - 资源请求 |
| `1029` | SLOW_ASSET_REQUEST - 资源请求慢 |
| `1032` | BLANK_SCREEN - 白屏错误 |
| `2048` | REPORT - 等同 ERROR，会触发告警但不扣分 |

## RUM 支持的地域

- `ap-guangzhou`（默认）
- `ap-singapore`
- `na-siliconvalley`
