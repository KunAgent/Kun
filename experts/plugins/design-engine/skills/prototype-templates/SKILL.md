---
name: prototype-templates
description: |
  9 种原型模板的结构定义和代码规范，覆盖网页、SaaS、仪表盘、移动端、PPT、文档等设计场景。
  每种模板定义了标准的 HTML 结构、必需的区块、布局规则和 Anti-Slop 约束。
  触发词：原型模板、页面结构、布局模板、网页结构、组件结构
---

# 原型模板库

## 功能说明

提供 9 种标准化的原型模板定义，帮助 prototype-builder 快速生成符合最佳实践的页面结构。

## 模板清单

| 模板 ID | 名称 | 适用场景 |
|---------|------|---------|
| web-prototype | 通用网页原型 | Landing page、Marketing page、产品展示 |
| saas-landing | SaaS 落地页 | 产品营销、功能展示、转化优化 |
| dashboard | 数据仪表盘 | 后台管理、数据分析、运营面板 |
| mobile-app | 移动端 App | iOS/Android 原型、多屏流程 |
| simple-deck | 简洁演示 | 轻量级展示、提案、demo |
| pricing-page | 定价页 | 方案对比、特性矩阵 |
| docs-page | 文档页 | 技术文档、帮助中心 |
| blog-post | 博客文章 | 内容营销、技术博客 |
| email-template | 邮件模板 | 营销邮件、通知邮件 |

## 参考资料

@references/template-structures.md — 每种模板的标准 HTML 结构定义

## 使用方式

1. 根据需求摘要中的场景选择对应模板
2. 参考模板结构生成 HTML 骨架
3. 填充设计系统的令牌（色彩、排版、间距）
4. 用真实感的占位内容替换模板占位符
5. 确保符合 Anti-Slop 规范
