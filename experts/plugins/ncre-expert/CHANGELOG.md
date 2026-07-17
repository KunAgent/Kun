# CHANGELOG

## v1.1.0 (2026-06-02)

### Added
- **降级处理机制**：主理人新增歧义处理、简单问题直答、成员返回异常处理、超纲问题处理四大降级策略
- **用户体验增强**：三阶段进度反馈（诊断完成/专家分析中/方案汇编中），quickPrompts 从 3 个扩展至 8 个，覆盖更多典型场景
- **版本标识**：所有 Agent prompt 文件添加 v1.1 版本号
- **降级规则**：四位成员各添加知识盲区、超纲问题、异常回传三类降级处理规则
- **首次使用引导**：defaultInitPrompt 增加引导性描述，帮助用户更快表达需求

### Changed
- **上下文效率优化**：主理人 prompt 删除冗余详细能力清单，替换为紧凑的关键词路由表，减少约 40% 篇幅
- **plugin.json**：版本升级至 1.1.0

### Fixed
- B01: 补充 settings.json
- B02: 团队头像缩放至 512×512 px
- B03: 团队头像压缩至 ≤500KB（113KB）
- S01: members[] displayName 改为 name: {en, zh}
- S02: README.md 补全 TODO 内容

## v1.0.0 (2026-05-27)

### Initial Release
- NCRE 一至四级五位专家 Agent（1 主理人 + 4 成员）
- 团队协作机制：TeamCreate 创建团队、Spawn 调度成员、SendMessage 回传
- 三个预设 Workflow：单级备考、级别选择、多级连续规划
- 单 Agent 直调路由表
- 各级别完整考纲覆盖
