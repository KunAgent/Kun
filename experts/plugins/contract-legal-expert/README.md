# Contract Legal Expert（腾讯电子签合同法务专家）

资深合同法务 AI 顾问，覆盖合同起草、审查、对比、法规检索四大能力。

## 类型

Agent 型（单个 AI 专家）

## 功能

- **合同起草**：基于业务诉求生成条款齐备、合规可签的初稿（采购、劳动、租赁、买卖、技术服务、NDA 等）
- **合同审查**：逐条识别违约/合规/权责不对等风险，给出修改建议并援引法条
- **合同对比**：精准比对版本异同，标注重大变更与谈判焦点
- **法规检索**：检索权威法律法规、司法解释，输出"问题-依据-建议"闭环意见

底层依赖内置 Skill `tencent-esign-contract`（腾讯电子签合同 AI 服务），位于 `skills/tencent-esign-contract/`，随专家包一并分发。

## 使用示例

- 帮我起草一份采购合同：甲方是A公司、乙方是B供应商，标的为办公电脑200台，含售后与违约条款。
- 请帮我审查这份租房合同，找出对租客不利的条款并给修改建议。
- 劳动合同期限 1 年，最多可以约定多长试用期？请给我相关法条原文。

## 头像

头像位于 `avatars/expert.png`（512×512 PNG，自定义替换需符合：PNG/JPG，≤500KB）。

## 目录结构

```
contract-legal-expert/
├── .codebuddy-plugin/
│   └── plugin.json
├── agents/
│   └── contract-legal-expert.md
├── avatars/
│   └── expert.png
├── skills/
│   └── tencent-esign-contract/      # 内置技能：腾讯电子签合同服务
│       ├── SKILL.md
│       ├── scripts/
│       ├── references/
│       └── icons/
└── README.md
```

## 鉴权

首次业务调用时，需引导用户前往 https://qian.tencent.com/aiSkill 获取 SIGN-TOKEN，由 `tencent-esign-contract` Skill 通过 `ESIGN_TOKEN` 环境变量或 `~/.esign-token` 持久化。详见 `skills/tencent-esign-contract/SKILL.md`。

## 安装

将整个 `contract-legal-expert/` 目录放到 WorkBuddy 插件市场目录下：

```
~/.workbuddy/plugins/marketplaces/my-experts/plugins/contract-legal-expert/
```

或直接通过专家市场上传本压缩包。

## 打包分享

```bash
zip -r contract-legal-expert.zip contract-legal-expert/
```
