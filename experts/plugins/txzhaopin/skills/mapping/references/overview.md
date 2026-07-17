# Mapping Skill Final 概览

`mapping-skill-final` 是一个独立可安装的人才 Mapping 综合 Skill，用于围绕目标公司、岗位、团队、技术方向或行业赛道生成招聘 Mapping 报告。

## 典型工作流

1. 通过 5 问问卷对齐目标公司、岗位方向、职级、地域和输出偏好。
2. 调用 `getCurrentUser` 获取 `{user_key}`，定位 `知识源/用户-{user_key}` 命名空间。
3. 在当前用户目录下执行 iWiki 查重和增量更新。
4. 根据行业与岗位路由到公开来源挖掘模块。
5. 合并多源证据，生成置信度、open questions 和候选人画像。
6. 输出 Markdown/HTML 报告，并沉淀到 iWiki 用户目录。

## iWiki 目录结构

```text
知识源
└── 用户-{user_key}
    ├── 00-索引
    ├── 01-公司组织库
    ├── 02-候选人档案
    ├── 03-项目经历库
    ├── 04-面评归档
    ├── 05-Mapping报告
    └── 99-变更日志
```

## 关键资源

- 根入口：`SKILL.md`
- 模块索引：`references/module-index.md`
- iWiki 写入协议：`references/iwiki-storage-protocol.md`
- 业务线画像模板：`profile-templates/`
- 渠道路由：`references/channel-routing.md`
- 意图解析：`references/routing/intent-parsing.md`
- 模块路由：`references/routing/skill-routing.md`
- 四阶段提示词参考（主进程串行 Read，非子代理）：`references/stage-prompts/`
- 报告模板：`templates/`

## 维护建议

- 新增业务线时，优先新增 `profile-templates/{domain}.md`，再补充 `references/channel-routing.md` 与根 `SKILL.md` 路由表。
- 新增挖掘来源时，在 `references/modules/` 增加模块说明，并在 `references/module-index.md` 登记。
- 所有知识沉淀必须遵循 `references/iwiki-storage-protocol.md`，不得写入其他用户目录。