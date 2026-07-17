# 扩写与精修中的事实标注（MAT / 待证实）

> **配套**：[`s3-expansion-phase.md`](./s3-expansion-phase.md) · [`quality-PLC.md`](../02-quality/quality-PLC.md) §C

---

## 规则

1. **新增**数据、引语、可核验案例：须能对应 `material-library.md` 或检索 ledger，正文用 **`[MAT-xxx]`** 或团队约定编号。
2. **无素材支撑**但需保留的表述：标 **「作者观察」** 或 **「行业共识（待补证）」**，不得伪装为已引用事实。
3. 精修阶段 **删除** 无法标注又声称可核验的句子，或改为上述两类之一。

## 扩写后抽检

- 运行 `quality-auditor-lite` 时关注 **事实无出处** 类告警；C 层人工勾选「新增段是否均有来源或已标待证实」。
