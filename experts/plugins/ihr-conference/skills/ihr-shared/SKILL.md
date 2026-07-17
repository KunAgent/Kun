---
name: ihr-shared
description: "iHR360 CLI 共享规则：ihr-cli 运行时、auth/config 规则、JSON 输出协议、时间处理与错误排查。"
---

# ihr-shared (v1)

## 作用

本 skill 不直接承载业务动作，只负责说明 `ihr-cli` 相关命令的共享规则：

1. CLI 运行时要求
2. auth/config 配置规则
3. 默认身份上下文约定
4. JSON 输入输出协议
5. 相对时间处理规则
6. 常见错误类型

## 运行时规则

### 1. CLI 运行时

1. 当前业务动作通过 `ihr-cli` 执行。
2. 结构化业务命令通常挂在 `ihr-cli <domain>` 下，例如 `ihr-cli base`、`ihr-cli conference`。
3. 原生网关调用器挂在 `ihr-cli interface` / `ihr-cli ihr-interface` 下。
4. 本目录是 `ihr-cli` 随包分发的共享 skill 位置。

### 2. 配置加载

1. 先执行 `ihr-cli config init --base-url <url>`。
2. 再执行 `ihr-cli auth login --api-token-stdin`。
3. `base`、`conference`、`ihr-interface` 等动作默认复用 `ihr-cli` 当前 profile 的配置与登录态。
4. 当前不再以 `.env` 作为主路径。

推荐初始化方式：

```bash
ihr-cli config init --base-url http://localhost:8090
printf '%s' "$IHR360_API_TOKEN" | ihr-cli auth login --api-token-stdin
```

### 3. 身份上下文

1. 业务语义上默认依赖服务端注入的身份上下文。
2. CLI 会自动从本地 credential store 读取 token，并注入请求头。
3. 领域 skill 不应把鉴权细节作为主流程重点说明。

## JSON 协议

### 1. 输入方式

当前 `ihr-cli` 同时存在两类输入模型：

1. 模板化 shortcut 的分项参数输入，例如 `base`、`conference`
2. 原生 interface 的 curl 风格输入，例如 `-H / -q / --json / --form`

业务动作文档应按自己所属模型说明输入方式。

模板化 shortcut 通用支持以下调试与输出参数：

| 参数 | 说明 |
|------|------|
| `--json <json>` | 直接传入 JSON 请求体，不能和分项参数混用 |
| `--stdin` | 从标准输入读取 JSON 请求体，不能和分项参数混用 |
| `--output-file <file>` | 将最终 JSON 结果额外写入指定文件 |

### 2. 输出结构

模板化 shortcut 通常输出单行 JSON：

```json
{"success":true,"command":"queryConference","request":{},"response":{}}
```

原生 `ihr-interface` 也输出单行 JSON，但 envelope 为：

```json
{"success":true,"command":"interface +post","request":{},"response":{}}
```

共享规则：

1. `success` 表示 CLI 动作是否执行成功
2. `command` 表示本次动作语义，例如 `queryConference` 或 `interface +post`
3. `request` 表示 CLI 最终构造出的请求信息
4. `response` 表示服务端响应信息
5. 对标准业务接口，业务数据通常仍从 `response.data` 读取

### 3. 错误结构

统一错误结构：

```json
{"success":false,"command":"queryConference","error":{"code":"CONFIG_ERROR","message":"配置缺失","details":{}}}
```

## 时间处理规则

1. 遇到“今天、昨天、上周、最近30天、去年年底到今年年初”这类相对时间，不要心算。
2. 先基于系统时间换算出绝对日期，再传给业务动作。
3. 时间字符串优先使用：
   1. `yyyy-MM-dd`
   2. `yyyy-MM-dd HH:mm:ss`

## 常见错误类型

| 错误码 | 含义 |
|---|---|
| `CONFIG_ERROR` | 配置缺失或配置格式非法 |
| `AUTH_REQUIRED` | 当前 profile 尚未 login |
| `ARGUMENT_ERROR` | 参数冲突、缺失或范围非法 |
| `VALIDATION_ERROR` | 原生 interface 参数非法 |
| `INVALID_JSON` | `--json` / `--stdin` 输入不是合法 JSON |
| `IO_ERROR` | 读取标准输入、上传文件或写输出文件失败 |
| `OUTPUT_ERROR` | 输出序列化失败 |
| `NETWORK_ERROR` | 网络请求失败 |
| `HTTP_ERROR` | 服务端返回非 2xx |
| `HTTP_INVALID_JSON` | 服务端响应不是合法 JSON |
| `UNEXPECTED_ERROR` | 未归类异常 |

## 使用方式

`ihr-cli` 的相关 skill 执行前，都应先理解本共享规则，再读取对应的 reference 文档。
