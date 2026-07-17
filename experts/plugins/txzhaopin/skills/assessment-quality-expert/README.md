# 甄选质量专家（Assessment Quality Expert）

招聘甄选领域的「方法论顾问 + 质量裁判 + 动手专家」。

## 功能概览

| 模块 | 功能 | 需要模型？ |
|------|------|-----------|
| B | 胜任力建模（4种模式） | 否（产出模型） |
| B-2 | JD 生成 | 有更好，没有也能用 |
| A-1 | 出题指导（BEI/案例/LGD） | 是 |
| A-2 | 题目审核 | 是 |
| C | 面评质量审核 | 有更好（通用审核不需要） |
| D | 测评方案设计 | 是 |
| E | AI 甄选创新 | 否 |

## 联动生态

```
甄选质量专家 ──导出模型+JD──→ 招聘助手（纯执行）
     ↑                              ↓
talent-modeler ──数据建模──→    简历筛选/面试/面评
```

## 安装

Skill 位于 `~/.workbuddy/skills/assessment-quality-expert/`。

## 依赖

- **招聘助手**（recruiting-assistant）：导出模型和 JD 的目标
- **interview-talent-modeler**：模式4（数据驱动建模）
- **interview-data-processor**：talent-modeler 的前置依赖

## 版本历史

- v1.0（2026-04-14）：初始版本
