# CodeBuddy 插件包说明（v2.1.2）

- **版本**：`2.1.2`
- **状态**：入口状态机固化·意图单真源·IntentOps 门禁增强版
- **产物**：`dist/fbs-bookwriter-v212-codebuddy.zip`
- **校验报告**：`dist/fbs-bookwriter-v212-codebuddy.verification.json`
- **通道清单**：`codebuddy/channel-manifest.json`
- **插件元数据**：`.codebuddy-plugin/plugin.json`（plugin-id: fbs-bookwriter-v212）

## 本次核心变更（相对 v2.1.1）

- **[I1] canonical 真源落地**：新增意图单真源 `intent-canonical.json`。
- **[I2] NLU 决策升级**：支持 Top-K 候选、置信分带、冲突消歧与弱信号降级。
- **[I3] 槽位补全**：`bookRoot/stage/targetChapter/outputFormat/riskMode` 最小补全能力落地。
- **[I4] 入口状态机信号**：`intake-router` 统一输出 `entryStateMachine` 字段。
- **[I5] 治理可观测性增强**：新增 `intent-ops-report` 供周报和词典治理使用。

## 构建入口

- `npm run pack:codebuddy`（仅 CodeBuddy 包）
- `npm run pack:release`（同时构建 WorkBuddy + CodeBuddy + OpenClaw）

## 提交 / 自测建议

1. 运行 `npm run pack:codebuddy`
2. 核查 `dist/fbs-bookwriter-v212-codebuddy.verification.json`
3. 重点确认 `.codebuddy-plugin/plugin.json`、`codebuddy/channel-manifest.json`、`references/01-core/intent-canonical.json` 已进入 ZIP 且版本一致
