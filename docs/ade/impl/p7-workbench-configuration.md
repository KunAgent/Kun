# P7 Code 融合工作台与配置实施入口

- 日期：2026-09-30。
- 状态：统一 Code 主链路已实现，完整桌面冒烟 19 项通过；逐项证据和未完成验收见 [实现状态](./p7-workbench-configuration/implementation-status.md)。
- 最新方向：ADE 能力融入 Code 单页面，沿用现有 UI，见 [融合设计](../14-code-workbench-integration.md)。
- 最新核对基线：`1f7b48968`；草稿、工作区和发送快照按当前已提交代码接续，开始实现前重新核对。
- 范围：Agent 接入修复、品牌图标、统一配置、作用域与快照、任务工作台、worker 查看/控制、待处理和审查交付。

完整计划正本放在本目录下的 `p7-workbench-configuration/`，本文提供导航。仓库默认忽略 `openspec/`，本地 OpenSpec change 通过文件链接读取同一份正本，避免维护两份任务状态。

| 阅读内容 | 文档 |
| --- | --- |
| 最新页面设计、复用与迁移决策 | [Code 融合设计](../14-code-workbench-integration.md) |
| 实施批次、依赖、代码位置、测试与回退 | [完整实施计划](./p7-workbench-configuration/implementation-plan.md) |
| Agent 接入故障与图标修复 | [接入专项](./p7-workbench-configuration/agent-connectivity.md) |
| 配置入口、页面、字段和交互 | [配置 UI 规格](./p7-workbench-configuration/configuration-ui.md) |
| 设置归属、继承、快照、版本与 API | [数据契约](./p7-workbench-configuration/contracts.md) |
| 架构决策、已有实现和风险 | [设计](./p7-workbench-configuration/design.md) |
| 自动化、实机、失败恢复与跨端矩阵 | [验收计划](./p7-workbench-configuration/acceptance.md) |
| 可逐项执行的任务状态 | [任务清单](./p7-workbench-configuration/tasks.md) |

## 本地 OpenSpec 入口

change 名为 `redesign-ade-workbench-and-configuration`。新的 checkout 可先用 `openspec new change` 创建该名称，再把本目录的 proposal/design/tasks、辅助文档和各 spec 链接或同步到生成目录；不得独立修改两份正本。需要跟踪任务状态时优先更新这里的 tasks。

## 实施顺序

1. A01 核对当前用户改动和实际能力。
2. B01-B02 修复 Agent 启动路径与接入，B03 统一品牌和可达性。
3. A02-A06 建立配置契约、保存事务、唯一入口与添加流程。
4. A07-A12 完成项目/任务作用域、工作区准备、worker 预览和控制。
5. A13-A15 完成待处理、成果版本、批注返工与交付。
6. A16、B04、A17-A18 完成布局性能、逐 Agent 实机验证、迁移回退及收口。

新增 U01-U04 单页面融合批次，与 A/B 合计 26 个批次。U01 是作用域/准入前置，U02 先于配置导航，U03 先于新建任务，U04 先于总验收；严格依赖以实施总计划为准。

## 与既有设计的关系

- P0-P4 已有底座继续复用；“已有代码”不替代本轮验收。
- P5 已有 UI 工作纳入对应批次；尚未实现的 Registry/新认证协议不是内置 Agent 修复的前置条件。
- P6 原生适配器复用；修正 effective catalog 与实际默认路径，不能只依据注释宣称已接通。
- `00-ade-mode.md` 的独立页面决策被用户新要求取代；单运行时、权限和生命周期边界继续保持。
- 本轮已执行产品实现与隔离测试。外部账号和上游服务限制单独记录；没有提交、推送或发布。

## 接入修复与实际限制

- Codex 新连接默认使用已有的原生 app-server，显式 ACP 配置保留；模型探测、缓存和取消按连接定义隔离。
- Cursor 使用 Cursor SDK 的模型来源；模型菜单和配置入口不再混用 CLI 登录或普通 HTTP 来源。
- AgentIcon 集中承载品牌资源，未就绪项保留可操作的配置入口。
- 发现程序、协议握手与真实回合分别报告。本机直连超时还暴露了未继承系统代理的问题，现已为 Codex/Claude 补齐。真实模型回合、OpenCode 用户插件错误及缺少 Antigravity Agent 程序分别记录，不能以握手代替完整执行验收。
- 详细平台与外部 Agent 限制见实现状态中的验证矩阵。
