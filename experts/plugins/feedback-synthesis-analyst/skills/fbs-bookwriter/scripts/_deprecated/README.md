# scripts/_deprecated — 废弃脚本归档目录

> **归档时间**：2026-04-11（v2.0.3）  
> **说明**：此目录存放已被替代或不再使用的历史脚本，保留以备查阅，不参与正常执行流程。

## 归档文件说明

### nlu-optimization.mjs（31.37 KB）

- **归档原因**：v2.0.3 引入 Sub-Agent 声明式定义（`.codebuddy/agents/`），
  `fbs-researcher.md` 的 `description` 字段可由宿主原生自动委派替代该脚本的意图识别功能。
  LLM 原生意图识别与此脚本存在大量功能重叠，保留会增加约 31KB 不必要的加载体积。
- **替代方案**：`.codebuddy/agents/fbs-researcher.md`（S0情报收集）

### nlu-optimization-enhanced.mjs（30.14 KB）

- **归档原因**：同上，为 `nlu-optimization.mjs` 的增强版，功能重叠更甚。
  v2.0.3 的 12 意图群路由表（`references/01-core/intake-and-routing.md §意图群路由`）
  已覆盖原有的 66 条离散指令，以更轻量的方式实现等效路由。
- **替代方案**：`references/01-core/intake-and-routing.md`（意图路由规范）

## 注意事项

- **不要直接运行**此目录下的任何脚本，其依赖的上下文可能已不存在
- **不要从主流程引用**此目录下的任何脚本
- 如需恢复某个功能，请先阅读相应替代方案，评估是否真的需要回滚
