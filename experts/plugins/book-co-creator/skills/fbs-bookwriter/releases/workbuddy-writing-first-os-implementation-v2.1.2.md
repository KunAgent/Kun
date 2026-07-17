# WorkBuddy Writing-First OS 实施单（v2.1.2）

> 目标：把“工程正确性”稳定转成“用户可感知的写作确定性”  
> 范围：入口体验、质检结论、技术动作解释、退出策略、发布验收  
> 适用版本：`2.1.2`

---

## 1) 北极星指标与门禁

- 北极星：`TTFW`（Time To First Writing，首轮到正文时间）持续下降。
- 结果指标：终稿通过率提升，且用户一次决策即可进入正确质检路径。
- 强制门禁：
  - 主对话区仅 `userFacingOneLiner + <=3 主选项`
  - 用户可见技术处理必须包含“为什么做 + 用户价值”
  - 质检必须输出“全局结论层”，不再只给分散分数

---

## 2) 工作包（按优先级）

## WP0（P0）：全局质量结论层

- **目标**：统一“终稿分”和“单章分”，输出单一可执行结论。
- **改造文件**：
  - `scripts/fbs-quality-full.mjs`（新增）
  - `scripts/polish-gate.mjs`（已具备 target 能力，需接入聚合）
  - `scripts/intake-router.mjs`（qc 路由接入聚合入口）
  - `fbs-runtime-hints.json`（新增聚合结果 JSON 路径）
- **核心输出字段**（建议）：
  - `bookQualityConclusion.overallStatus`：`pass|warn|fail`
  - `bookQualityConclusion.finalManuscript`
  - `bookQualityConclusion.deliverables`
  - `bookQualityConclusion.comparabilityNote`
  - `bookQualityConclusion.nextBestAction`

## WP1（P0）：入口动作目标影响打标

- **目标**：所有动作按 `writing|quality|maintenance` 打标，默认写作优先。
- **改造文件**：
  - `scripts/intake-router.mjs`
  - `scripts/lib/intake-ux-enhancements.mjs`
  - `references/06-plugin/workbuddy-host-integration.md`
- **规则**：
  - 主按钮仅展示 `goalImpact=writing`
  - `quality/maintenance` 进入二级选项或确认后执行

## WP2（P1）：用户可见技术动作解释合同

- **目标**：消除“只见命令，不知价值”的不安感。
- **改造文件**：
  - `fbs-runtime-hints.json`（`userExperience.visibleTechActionNarration`）
  - `scripts/intake-router.mjs`（`userVisibleTechActionNarration`）
  - `references/05-ops/ux-agent-playbook.md`
- **规则**：任何可见技术处理必须含四句模板：
  - 做什么
  - 为什么
  - 对用户价值
  - 失败兜底

## WP3（P1）：退出策略产品化

- **目标**：退出默认极简，复盘按需生成。
- **改造文件**：
  - `scripts/session-exit.mjs`
  - `scripts/test/session-exit.test.mjs`
  - （可选）`scripts/retro-action-sync.mjs`（按需复盘入口）
- **规则**：
  - 默认只输出“已记录 + 下次继续点 + 变更数量”
  - 长复盘仅在用户明确要求时触发

## WP4（P1）：真实路径 E2E 回归

- **目标**：防止“功能通过但体验回退”。
- **改造文件**：
  - `scripts/test/e2e-writing-first.test.mjs`（新增）
  - `package.json`（新增 e2e 命令）
- **覆盖路径**：
  - `福帮手 -> 3 -> 1 -> 退出福帮手`
  - 校验：首屏稳定、范围确认、质检目标正确、退出简洁

---

## 3) 命令级验收清单（可直接执行）

```bash
npm run validate:runtime-hints
npx vitest run --config vitest.config.mjs scripts/test/intake-router.test.mjs scripts/test/polish-gate.test.mjs scripts/test/session-exit.test.mjs
npm test
npm run audit:consistency
npm run audit:all:strict
npm run pack:release
```

验收通过标准：

- 所有命令退出码为 `0`
- `pack:release` 产出 `dist/fbs-bookwriter-v212-workbuddy.zip`
- 不出现“主按钮来自 actions.slice(0,3)”的回退实现

---

## 4) KPI 字段定义（机读）

建议在 `firstResponseContext` / `runtime` 增加或固化以下字段：

- `kpiSignals.timeToFirstWritingMs`
- `kpiSignals.primaryWritingActionRate`（首屏动作中写作类占比）
- `kpiSignals.visibleTechNarrationCoverage`（可见技术动作解释覆盖率）
- `kpiSignals.qcScopeConfirmedRate`（质检前范围确认率）
- `kpiSignals.globalQualityConclusionAvailable`（是否输出全局结论层）
- `kpiSignals.exitCompactMessageRate`（退出极简消息命中率）

建议阈值（两周）：

- `primaryWritingActionRate >= 0.9`
- `visibleTechNarrationCoverage = 1.0`
- `qcScopeConfirmedRate = 1.0`
- `globalQualityConclusionAvailable = 1.0`

---

## 5) 实施节奏（两周）

- 第 1-2 天：WP0 方案与字段落盘
- 第 3-4 天：WP1 入口分层与宿主契约同步
- 第 5-6 天：WP2 解释合同全链路接入
- 第 7-8 天：WP3 退出策略收口
- 第 9-10 天：WP4 E2E 回归与门禁化
- 第 11-14 天：灰度观察 + 指标复盘 + 打包发布

---

## 6) 交付物列表

- 实施单：`releases/workbuddy-writing-first-os-implementation-v2.1.2.md`
- 验收记录（执行后补充）：`releases/workbuddy-writing-first-os-acceptance-v2.1.2.md`
- 发布包：`dist/fbs-bookwriter-v212-workbuddy.zip`

