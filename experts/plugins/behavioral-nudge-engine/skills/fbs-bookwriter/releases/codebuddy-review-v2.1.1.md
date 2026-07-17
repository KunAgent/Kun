# CodeBuddy 插件包说明（v2.1.1）

- **版本**：`2.1.1`
- **状态**：长上下文钉住·阶段门禁执行锁·质检强制闭环版
- **产物**：`dist/fbs-bookwriter-v211-codebuddy.zip`
- **校验报告**：`dist/fbs-bookwriter-v211-codebuddy.verification.json`
- **通道清单**：`codebuddy/channel-manifest.json`
- **插件元数据**：`.codebuddy-plugin/plugin.json`（plugin-id: fbs-bookwriter-v211）

## 本次核心变更（相对 v2.1.0）

- **[A1] S0-Init 7锁文件初始化**：7 个锚点文件建立规范（author-meta / 术语锁定记录 / commitments / character-registry / track-linkage / project-config / 叙事策略），S0-A 完成后立即触发
- **[A2] S0 最小必填集降级方案**：Node.js 不可用时 AI 手动引导的 4 步降级路径，完成前禁止进入 S3 成文
- **[A3] 阶段推进门禁**：S0→S1 到 S4→S5 每个边界前置条件检查表，不满足时 AI 拒绝推进并说明缺失项
- **[A4–A8] 质检强制闭环**：20+3 条 S4 勾选表、分步执行规范、承诺兑现注册表、S0 锚点写入系统记忆规范
- **[C1–C7] 质量规则升级**：C5 P1 强制、A 类词扩充、字数完成度门禁、承诺兑现率 P0 门禁

## 构建入口

- `npm run pack:codebuddy`（仅 CodeBuddy 包）
- `npm run pack:release`（同时构建 WorkBuddy + CodeBuddy）

## 提交 / 自测建议

1. 运行 `npm run pack:codebuddy`
2. 核查 `dist/fbs-bookwriter-v211-codebuddy.verification.json`
3. 重点确认 `.codebuddy-plugin/plugin.json`、`.codebuddy/agents/fbs-team-lead.md`、`codebuddy/channel-manifest.json` 已进入 ZIP，版本号均为 `2.1.1`
