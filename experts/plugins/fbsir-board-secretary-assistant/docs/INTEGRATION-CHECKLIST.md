# 董秘助手审核包联调验收清单

## 本轮已完善

- `api2-runtime-boundary-smoke` 已对齐当前上架签名：`wb_fbsir_board_secretary_compliance_red_team` / `board_secretary_ir_workflow` / `board_secretary`。
- 审核包基于当前 WorkBuddy 上架包候选源生成，不改运行中的已上架包。
- 审核包内固定人工复核、来源追溯、禁止自动发布和禁止自动法律结论边界。

## 导入或联调后推荐验证

1. `npm.cmd run preflight:api2:local` - verify starter semantics and local host-facing contract alignment
2. `npm.cmd run preflight:api2` - verify remote host-facing contract alignment
3. `npm.cmd run report:service-traction:action-queue` - verify board packCode / scenePackId / product signature remains readable in the action queue
4. `npm.cmd run report:service-traction:priority-alignment` - verify board remains the current performance reference without collapsing industry blocker semantics
5. `npm.cmd run report:service-traction:product-upgrade-demands` - verify board host-side requirement wording remains aligned to listed-product runtime guard semantics
6. `npm.cmd run report:service-traction:workbuddy-upgrade-demand-queue` - verify board upgrade queue still treats board as clean-credit-ready reference and not a closure substitute for other products
7. `npm.cmd run report:service-traction:host-runtime-consistency` - verify board host runtime remains aligned to expert_center and does not regress to unknown fields
8. `npm.cmd run gate:api2:release-candidate` - verify packaged entry and release truth remain auditable after the board package import
9. `npm.cmd run gate:api2:runtime-boundaries` - verify the board line still preserves same-binding whoami -> scene-pack -> consume boundary semantics after package import
10. `npm.cmd run gate:api2:runtime-boundaries` - 验证同绑定首值 consume 边界和董秘助手当前签名。

## 停止条件

- `entrySurface/requestSource/terminal/version` 回退到 `unknown`。
- `probe/synthetic/diagnostic` 进入自然产品信用。
- 审核包被误写为正式披露、投资建议、监管回复提交或交易许可结论。
