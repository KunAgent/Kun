# 入口状态机（技术细则版）

> 版本：v1.1  
> 范围：Skill 启动入口、路由决策、门禁策略、失败回退、证据工件。

---

## 1. 目标

- 将用户入口统一为可判定状态机，避免“同词不同处理”。
- 将「脚本存在但未触发」降为可审计异常。
- 将运行态与治理态路径彻底解耦，防主体漂移。

---

## 2. 状态定义

- `E0-ProjectAnchor`：项目锚定（唯一 `bookRoot`）
- `E1-ColdStart`：冷启动（无可恢复工件）
- `E2-HotResume`：热恢复（恢复卡可直接执行）
- `E3-StaleResume`：半恢复（需校准）
- `E4-IntentRoute`：意图分流
- `E5-RiskGate`：风险前置门禁
- `E6-Execute`：执行链
- `E7-Exit`：退出收口

---

## 3. 转移规则

- 启动主线：`E0 -> (E1|E2|E3) -> E4 -> E5 -> E6`
- 退出：`* -> E7`
- 约束：
  - `projectAnchor=ambiguous` 时停留 `E0`
  - 未确认 `bookRoot` 前禁止读取 `.fbs/*`

---

## 4. 意图到执行链映射

- `write`：`s3-guard` / `standard-execution-chain`
- `qc/delivery`：`run-p0-audits` + 交付门禁链
- `governance`：`midterm-execution-chain` / `midterm-governance-report` / `midterm-milestone-report`
- `search-risk`：`high-risk-dual-source-gate` + `temporal-anchor-missing-checklist`
- `exit`：`session-exit`

---

## 5. 风险门禁级别

- `block`：必须阻断（enforce 场景默认）
  - 主体漂移（`driftCount > 0`）
  - 高风险双源缺口
  - 核心阶段门禁失败
- `warn`：可继续但必须留痕
  - temporal checklist 缺项
  - legacy reports 回读
- `pass`：可继续执行

---

## 6. 工件边界

- 运行态（会话/状态/周摘要）：`.fbs/`、`.fbs/reports/`
- 治理态（中期链/看板/里程碑）：`.fbs/governance/`
- 禁止：`midterm-*` 治理工件落入 `.fbs/reports/`
- 修复：`normalize-governance-artifacts`

---

## 7. 对话首句模板（技术约束）

- 仅输出：`当前状态一句 + 下一动作一句`
- 禁止泄露内部术语与脚本实现细节
- 离线时必须显式标注“离线降级”

---

## 8. 失败回退策略

- 门禁失败：返回“失败原因 + 最短修复命令”
- 多项目歧义：返回候选根目录并等待确认
- 工件漂移：先 `governance:normalize` 再重跑治理报告
- 退出失败：人工最小恢复卡兜底（`lastAction/modifiedFiles/nextRecommendations`）

---

## 9. 观测指标（绑定状态机）

- 触发自动化率（E0-E6 链路命中）
- 时态可信率（E5 通过率）
- 恢复成功率（E2/E3 到 E6 的一次成功率）
- 证据完备率（E6/E7 工件齐全率）
- 知识复用率（知识卡回引）
- 主体漂移计数（治理工件越界）

---

## 10. 验收建议

- 用 fixtures 跑完整链：`midterm:chain -> midterm:governance -> midterm:milestone`
- 人为制造漂移工件，验证 `governanceBoundaryDrift` 与 normalize 回收
- enforce 模式验证阻断语义一致性（同类风险同退出码）

