# interface +get / +head / +options

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 和 [`../SKILL.md`](../SKILL.md)。

这组动作用于无请求体场景：

1. `+get`
2. `+head`
3. `+options`

## 典型命令

```bash
# 基于当前 profile 的 baseUrl 调 GET
ihr-cli interface +get /gateway/sk/check_user

# 追加 header
ihr-cli interface +get /gateway/sk/check_user -H 'X-Debug: true'

# dry-run
ihr-cli interface +get /gateway/sk/check_user --dry-run
```

## 参数

| 参数 | 说明 |
|---|---|
| `<target>` | 必须以 `/` 开头的相对路径 |
| `-q, --query <key=value>` | 追加 query 参数，可重复 |
| `-H, --header <key: value>` | 追加请求头，可重复 |
| `-i, --include` | 在输出中包含响应头 |
| `-o, --output <file>` | 将响应体原样写入文件 |
| `--dry-run` | 只构造请求，不真正发出 |
| `--timeout <ms>` | 覆盖当前 profile 的总超时 |
| `--connect-timeout <ms>` | 设置连接超时 |

## 约束

1. `+get / +head / +options` 不允许使用 `--json / --data / --stdin / --form`
2. 不能手工覆盖当前 profile 的鉴权头
3. 相对路径依赖当前 profile 已配置 `baseUrl`
4. 不允许传完整 URL
