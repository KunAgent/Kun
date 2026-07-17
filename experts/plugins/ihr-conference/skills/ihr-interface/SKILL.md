---
name: ihr-interface
description: "iHR360 原生网关调用器：复用 ihr-cli 当前登录态和 baseUrl，按 curl 风格直接调用任意 IHR 接口。适合作为通用 escape hatch，而不是模板化业务 skill 的替代品。"
metadata:
  requires:
    bins: ["ihr-cli"]
  cliHelp: "ihr-cli interface --help"
---

# ihr-interface (v1)

**CRITICAL — 开始前 MUST 先阅读 [`../ihr-shared/SKILL.md`](../ihr-shared/SKILL.md)。**

## 定位

`ihr-interface` 是一个原生网关调用器：

1. 自动复用 `ihr-cli` 当前 profile 的 `baseUrl`
2. 自动注入当前登录态对应的鉴权头
3. 只允许传以 `/` 开头的相对路径
4. 参数风格接近 curl

它不是模板化业务 skill 的替代品。

规则：

1. 对已正式产品化的业务能力，优先建设模板化 skill，例如 `ihr-conference`
2. 只有在“需要直接打某个还没封装成业务 shortcut 的接口”时，才使用 `ihr-interface`

## 支持动作

| Action | 说明 |
|---|---|
| [`+get`](references/ihr-interface-get.md) | GET 查询，适合 query 参数场景 |
| [`+post`](references/ihr-interface-post-json.md) | POST 请求，适合 JSON body 场景 |
| [`+put`](references/ihr-interface-post-json.md) | PUT 请求，参数语义与 `+post` 相同 |
| [`+patch`](references/ihr-interface-post-json.md) | PATCH 请求，参数语义与 `+post` 相同 |
| [`+delete`](references/ihr-interface-post-json.md) | DELETE 请求，可选 body |
| [`+head`](references/ihr-interface-get.md) | HEAD 请求 |
| [`+options`](references/ihr-interface-get.md) | OPTIONS 请求 |
| [`multipart`](references/ihr-interface-multipart.md) | multipart/form-data 上传约定 |

## 核心规则

1. 相对路径会基于当前 profile 的 `baseUrl` 解析
2. 不允许传完整 URL
3. 不允许手工覆盖 CLI 自动注入的鉴权头
4. `--json / --data / --data-binary / --stdin / --form(--form-file)` 只能选一种 body 模式
5. `+get / +head / +options` 不允许请求体

## 常见场景

1. 直接调用还没封装成模板 skill 的内部接口
2. 快速验证网关转发是否正常
3. 在不暴露鉴权细节的前提下，用 CLI 代替裸 curl

## 示例

```bash
# GET + dry-run
ihr-cli interface +get /gateway/sk/check_user --dry-run

# POST + JSON
ihr-cli interface +post /your/business/path --json '{"demo":true}'

# multipart 上传
ihr-cli interface +post /gateway/upload -F scene=demo --form-file file=@/tmp/demo.txt
```
