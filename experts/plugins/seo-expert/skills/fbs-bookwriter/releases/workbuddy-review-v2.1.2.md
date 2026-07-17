# WorkBuddy 官方审核包说明（v2.1.2）

- **版本**：`2.1.2`
- **状态**：入口状态机固化·意图单真源·IntentOps 门禁增强版
- **审核包**：`dist/fbs-bookwriter-v212-workbuddy.zip`
- **校验报告**：`dist/fbs-bookwriter-v212-workbuddy.verification.json`
- **通道清单**：`workbuddy/channel-manifest.json`
- **配套 CodeBuddy 包**：`dist/fbs-bookwriter-v212-codebuddy.zip`

## 本次核心变更（相对 v2.1.1）

- **[I1] 意图单真源**：新增 `references/01-core/intent-canonical.json`，统一识别、消歧、补全、召回配置。
- **[I2] NLU 2.1.2 主实现**：`scripts/nlu-optimization.mjs`/`nlu-optimization-enhanced.mjs` 切换到 canonical 驱动，支持 Top-K 候选与置信分带。
- **[I3] 弱信号降级**：`好/嗯/可以` 等高歧义词不再直接触发高风险动作。
- **[I4] 冲突矩阵**：内建 `CONTINUE/CONFIRM_TOPIC`、`STOP/EXPORT` 等冲突对，触发澄清优先。
- **[I5] 入口状态机运行时字段**：`intake-router` 输出 `entryStateMachine`（E0-E7）供宿主与审计统一观测。
- **[I6] IntentOps 报告**：新增 `scripts/intent-ops-report.mjs`，可输出澄清率与低置信率治理指标。

## 打包校验关注点

重点核对以下文件已进入 ZIP：

1. `workbuddy/channel-manifest.json`（version: 2.1.2）
2. `.codebuddy-plugin/plugin.json`（version: 2.1.2）
3. `references/01-core/intent-canonical.json`
4. `references/01-core/intent-canonical.generated.md`
5. `scripts/lib/intent-canonical.mjs`
6. `scripts/nlu-optimization.mjs`
7. `scripts/nlu-optimization-enhanced.mjs`
8. `scripts/intent-ops-report.mjs`

以 `dist/fbs-bookwriter-v212-workbuddy.verification.json` 为最终校验真值。

## 提交建议

提交 WorkBuddy 官方审核时，优先附上：

1. `dist/fbs-bookwriter-v212-workbuddy.zip`
2. `dist/fbs-bookwriter-v212-workbuddy.verification.json`
3. `workbuddy/channel-manifest.json`
4. 本说明文件 `releases/workbuddy-review-v2.1.2.md`
