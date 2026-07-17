# 董秘助手

`董秘助手` 用于在公告、路演、投资者问答、互动回复、调研纪要和沟通稿对外使用前，先做一轮结构化合规红队审查。

默认输出聚焦五件事：

- 风险等级
- 触发依据
- 问题片段
- 补证要求
- 建议改写与人工复核下一步

边界固定如下：

- `publishReady=false`
- `publicDisclosureAllowed=false`
- `manualReviewRequired=true`
- 不提供最终法律意见
- 不替代正式披露、审批或发布动作

当前 `2.1` 包还包含服务侧联调所需的合同与审核材料，但这些材料不等于官方运行态替换，也不等于自然 same-binding 产品信用完成。

更完整的审核与联调说明见：

- `REVIEW-PACKET.md`
- `contracts/first-value-contract.json`
- `contracts/governance-boundary.json`
- `contracts/service-forward-fields.json`
- `contracts/service-traction-upgrade-contract.json`

可选服务增强边界：

- 专家包不再携带 `.mcp.json`、`mcpServers` 或 host-tool-exposure 入口级元数据。
- 服务侧观察和 same-binding followthrough 只能通过服务侧真实流量与宿主证据对齐，不得在用户打开专家时触发连接器弹窗。
- 如果宿主没有暴露服务增强能力，专家仍必须直接基于用户材料交付第一张合规红队卡，不向用户展示工具或连接状态诊断。
