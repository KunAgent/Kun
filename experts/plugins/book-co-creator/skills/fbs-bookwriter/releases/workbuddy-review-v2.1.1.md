# WorkBuddy 官方审核包说明（v2.1.1）

- **版本**：`2.1.1`
- **状态**：长上下文钉住·阶段门禁执行锁·质检强制闭环版
- **审核包**：`dist/fbs-bookwriter-v211-workbuddy.zip`
- **校验报告**：`dist/fbs-bookwriter-v211-workbuddy.verification.json`
- **通道清单**：`workbuddy/channel-manifest.json`
- **配套 CodeBuddy 包**：`dist/fbs-bookwriter-v211-codebuddy.zip`

## 本次核心变更（相对 v2.1.0）

- **[A1] S0-Init 7锁文件初始化**：新增 S0-Init 节，定义 7 个锚点文件建立规范，防止长上下文漂移
- **[A2] S0 最小必填集降级方案**：`intake-router.mjs` 不可用时的 4 步手动引导降级路径
- **[A3] 阶段推进门禁**：S0→S1 到 S4→S5 每个边界增加前置条件检查，不满足时 AI 拒绝推进
- **[A4] S4 质检 20+3 条强制勾选表**：零条目可跳过，任何❌时综合分不得高于 7.5
- **[C1] C5 章节衔接升级为 P1 强制**：不区分串行/并行，C 层计分从 ÷4 改为 ÷5
- **[C2] A 类词扩充**：新增「必须/务必/绝不能」等绝对化命令词（全书 ≤ 3 次）
- **[C3] 字数完成度门禁**：< 50% 时 S4 强制不通过
- **[C4] 承诺兑现率升级为 P0 门禁**：任一未兑现 = S4 不通过

## 打包校验关注点

重点核对以下文件已进入 ZIP：

1. `workbuddy/channel-manifest.json`（version: 2.1.1）
2. `.codebuddy-plugin/plugin.json`（version: 2.1.1）
3. `.codebuddy/agents/fbs-team-lead.md`
4. `.codebuddy/providers/provider-registry.yml`
5. `references/01-core/intake-and-routing.md`（含阶段推进门禁章节）
6. `references/01-core/workflow-volumes/workflow-s0.md`（含 S0-Init 节）
7. `references/02-quality/quality-check.md`（含 §5 质检强制规范）
8. `references/02-quality/quality-PLC.md`（C5 P1 强制 + 附加三项）

以 `dist/fbs-bookwriter-v211-workbuddy.verification.json` 为最终校验真值。

## 提交建议

提交 WorkBuddy 官方审核时，优先附上：

1. `dist/fbs-bookwriter-v211-workbuddy.zip`
2. `dist/fbs-bookwriter-v211-workbuddy.verification.json`
3. `workbuddy/channel-manifest.json`
4. 本说明文件 `releases/workbuddy-review-v2.1.1.md`
