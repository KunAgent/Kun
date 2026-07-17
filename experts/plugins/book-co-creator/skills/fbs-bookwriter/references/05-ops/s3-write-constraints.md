# S3 写作阶段写入约束（规范真值）

> 与根目录 [`fbs-runtime-hints.json`](../../fbs-runtime-hints.json) 中 `s3` 字段一致。

| 约束 | 值 | 说明 |
|------|-----|------|
| 每轮最多修改文件数 | `maxFilesModifiedPerTurn`（默认 2） | 与 SKILL 速查表一致 |
| 串行修改 | `serialEdits: true` | 完成其一再处理下一文件 |
| 修改前可见性 | `visibilityBeforeEdit: true` | 先说明改哪些文件与范围 |

宿主或模型应优先遵守 `fbs-runtime-hints.json`；本文件为可读说明，**非**运行时强制引擎。
