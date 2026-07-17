# interface multipart 上传

> **前置条件：** 先阅读 [`../../ihr-shared/SKILL.md`](../../ihr-shared/SKILL.md) 和 [`../SKILL.md`](../SKILL.md)。

当接口需要 `multipart/form-data` 时，使用：

1. `-F, --form <key=value>`
2. `--form-file <key=@file>`

## 示例

```bash
# 只传 form 字段
ihr-cli interface +post /gateway/upload -F scene=demo -F bizType=conference

# form + 文件
ihr-cli interface +post /gateway/upload \
  -F scene=demo \
  --form-file file=@/tmp/demo.txt
```

## 规则

1. `-F` 和 `--form-file` 可以组合
2. `--form-file` 的格式必须是 `field=@/path/to/file`
3. multipart 模式不能再与 `--json / --data / --stdin` 混用
4. 若未显式传 `--content-type`，CLI 会自动生成 multipart 边界
