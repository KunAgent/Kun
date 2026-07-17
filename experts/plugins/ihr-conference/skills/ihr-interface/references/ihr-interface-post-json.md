# interface +post / +put / +patch / +delete

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 和 [`../SKILL.md`](../SKILL.md)。

这组动作适合带请求体的原生接口调用：

1. `+post`
2. `+put`
3. `+patch`
4. `+delete`

## JSON 请求

```bash
ihr-cli interface +post /your/business/path --json '{
  "demo": true,
  "staffId": "46b24458-866e-4f72-a68d-5cc1a21bc34f"
}'
```

## 文本 / 二进制请求

```bash
# 发送文本 body
ihr-cli interface +post /gateway/demo -d 'name=value'

# 发送二进制 body
ihr-cli interface +post /gateway/demo --data-binary @/tmp/demo.bin --content-type application/octet-stream

# 从标准输入读取 body
cat /tmp/request.json | ihr-cli interface +post /gateway/demo --stdin --content-type application/json
```

## 约束

1. `--json / --data / --data-binary / --stdin / --form(--form-file)` 只能选一种
2. `--json` 必须是合法 JSON
3. `--data-binary @file` 会直接读取文件原始字节
4. 没显式指定 `--content-type` 时：
   1. `--json` 默认 `application/json; charset=utf-8`
   2. `--data` 默认 `application/x-www-form-urlencoded`
   3. `--data-binary` 默认 `application/octet-stream`
5. `<target>` 必须是以 `/` 开头的相对路径
