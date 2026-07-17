# ImaSearch 知识库检索 HTTP 接口协议

## 概述

AgentTool 对外提供的知识库检索接口。通过请求体里的 `scene` 字段切换上游：

| scene | 上游 | 说明 |
|-------|------|------|
| 空 / `ima` | ima openapi RAG | 默认场景，通用知识库检索 |
| `gaokao` | ContentApiGateway（kinfra）| 高考知识库检索，带每人每日限频 |

两种场景返回**同一套裁剪后的结构**（`chunks` 列表），调用方无需感知上游差异。

- 协议：HTTPS
- 编码：UTF-8
- 数据格式：`application/json`
- 方法 / 路径：`POST /agenttool/v1/imasearch`
- 鉴权：网关层（openid-connect / api key）完成；服务侧通过 `UIDMiddleware` 解析用户身份（用于高考场景限频）

---

## 请求

### Headers

| Header | 必填 | 说明 |
|--------|------|------|
| `Content-Type` | 是 | `application/json` |
| `Authorization` / `X-Userinfo` | 否 | 由网关注入；用于解析 uid（高考场景限频按 uid 计数，缺失时回退 client IP） |

### Body

```json
{
  "query": "新高考3+1+2选科组合对应可报专业有哪些",
  "limit": 20,
  "scene": "gaokao"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 检索关键词 |
| `limit` | int | 否 | 返回条数。`ima` 场景：未传用配置默认值，显式传需落在 `[limit_min, limit_max]`，越界报错。`gaokao` 场景：复用为 `top_k`，未传用配置 `gaokao.top_k` |
| `scene` | string | 否 | 场景：`""` / `"ima"`（默认）/ `"gaokao"` |

---

## 响应

### 成功（HTTP 200）

```json
{
  "chunks": [
    {
      "chunk_title": "2025年新高考3+1+2选科组合与专业对照表（物理类）",
      "chunk_abstract": "资源摘要（部分场景支持）",
      "chunk_url": "<hidden-doc-url>",
      "content": "选择物理+化学+生物组合的考生，专业可报率最高……",
      "score": 0.9421
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `chunks` | array | 命中的内容分片列表 |
| `chunks[].chunk_title` | string | 标题 |
| `chunks[].chunk_abstract` | string | 摘要（`ima` 取分片摘要；`gaokao` 取文档 `summary`） |
| `chunks[].chunk_url` | string | 来源/外链 URL |
| `chunks[].content` | string | 正文内容 |
| `chunks[].score` | float | 相关性分数（`ima` 取 `overall_score`；`gaokao` 取 `rerank_score`） |

### 失败

```json
{ "code": 14003, "msg": "daily search limit exceeded, please try again tomorrow" }
```

| 场景 | HTTP | code | 说明 |
|------|------|------|------|
| 参数错误（缺 query / JSON 非法 / limit 越界） | 400 | `ParameterInvalid` | — |
| 高考每日限频超限 | 429 | `RateLimitError`(14003) | 仅 `gaokao` 场景 |
| 上游请求失败 / 响应解析失败 / 上游错误码非 0 | 500 | `InternalServerError` | — |

---

## 高考(gaokao)场景说明

### 上游：ContentApiGateway

- 北极星名：`trpc.kinfra.content_api_gateway.ContentApiGateway`（kinfra 团队提供，非本仓库定义）
- 域名：由 AgentTool 服务端配置，专家包脚本不直连、不自行传入。
- AgentTool 透传给上游的请求体：

```json
{
  "query": "...",
  "top_k": 20,
  "filter": { "sources": [ { "source": 3 } ] }
}
```

`filter.sources` 固定取自配置 `ima_search.gaokao.sources`（默认 `[3]`，高考来源），调用方无需传。

### 上游鉴权

上游鉴权由 AgentTool 服务端统一处理。专家包脚本只向 AgentTool 传入本次调用新获取的 Bearer token，不自行生成或传递上游签名字段。

### 限频

- 维度：**每人每天**，可配 `ima_search.gaokao.daily_limit`（默认 `10`，`0` = 不限）。
- 用户标识：优先 uid（`UIDMiddleware` 解析），缺失时回退 client IP。
- 计数时机：**检索成功后**才累加（失败的检索不计入限额）。
- 超限：返回 HTTP 429 / `RateLimitError`，并打 Error 级日志（含 `uid`/`key`/`client_ip`/`query`，固定标记 `imasearch gaokao daily limit exceeded`，便于事后按 uid 捞取）。
- 依赖 Redis；Redis 未初始化时降级为不限频（fail-open）。

---

## 配置（`ima_search`）

```json
"ima_search": {
  "base_url": "https://ima-test.qq.com/openapi/rag/v1/search",
  "client_id": "...",
  "api_key": "...",
  "strategy_id": "yuanbao_openapi_search",
  "limit": 10,
  "limit_min": 5,
  "limit_max": 20,
  "recall_strategy": 0,
  "score_threshold": 0.5,
  "pre_filter_type": 0,
  "categories": [],
  "timeout_sec": 30,
  "gaokao": {
    "base_url": "<agenttool-server-internal-upstream-url>",
    "app_id": "50001",
    "app_secret": "sk_gaokao_demo_secret",
    "sources": [3],
    "top_k": 20,
    "timeout_sec": 30,
    "daily_limit": 10
  }
}
```

| 字段 | 说明 |
|------|------|
| `gaokao.base_url` | AgentTool 服务端内部配置的 ContentApiGateway URL，专家包脚本不使用 |
| `gaokao.app_id` / `gaokao.app_secret` | AgentTool 服务端内部加签所需 appid 与密钥，专家包脚本不使用 |
| `gaokao.sources` | `filter.sources` 来源过滤（高考来源 `3`） |
| `gaokao.top_k` | 默认返回条数（请求未传 `limit` 时使用） |
| `gaokao.timeout_sec` | 上游请求超时（秒） |
| `gaokao.daily_limit` | 每人每天搜索次数上限；`0` = 不限 |

---

## 示例

### 默认 ima 场景

```bash
curl -X POST 'https://copilot.tencent.com/agenttool/v1/imasearch' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{ "query": "林俊旸", "limit": 8 }'
```

### 高考场景

```bash
curl -X POST 'https://copilot.tencent.com/agenttool/v1/imasearch' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{ "query": "新高考3+1+2选科组合对应可报专业有哪些", "scene": "gaokao", "limit": 20 }'
```
