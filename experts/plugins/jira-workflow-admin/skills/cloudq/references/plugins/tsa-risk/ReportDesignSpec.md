# 报告内容规范

## 报告模块（按顺序排列）

1. **架构图基础信息** — 架构图名称、评估时间、架构图缩略图
2. **巡检评分** — 当前巡检得分及趋势
3. **巡检资源概览** — 巡检产品数、资源数、覆盖率
4. **风险项统计** — 高风险/中风险/健康项数量，与上周对比
5. **架构图风险趋势** — 风险变化趋势图表
6. **产品风险 TOP** — 当前架构图产品风险排名
7. **卓越架构五大维度** — 安全、可靠、性能、成本、服务限制维度得分
8. **风险明细列表** — 展示部分具体风险项（实例ID、策略名称、风险等级、状态等）
9. **报告分析** — AI 基于巡检数据自动生成的专业分析总结与优化建议

## 报告样式要求

- 采用腾讯系设计风格（TDesign 色彩体系）
- 适配移动端查看（440px 宽度）
- 支持 6 套主题随机切换：`ocean`（海洋蓝）、`sunset`（日落橙）、`forest`（森林绿）、`lavender`（薰衣草紫）、`coral`（珊瑚粉）、`slate`（石板灰）

## 模板系统

主题配置以 JSON 文件形式存放在 `references/plugins/tas-risk/template/` 目录下：

```
template/
├── default/           # 默认模板（6 套腾讯系风格主题，不可覆盖）
│   ├── ocean.json
│   ├── sunset.json
│   ├── forest.json
│   ├── lavender.json
│   ├── coral.json
│   └── slate.json
└── <自定义名>/        # 用户自定义模板（通过 --save-template 创建）
    └── <theme>.json
```

### 模板 JSON 字段说明

| 字段 | 说明 |
|------|------|
| `id` / `name` | 主题标识 / 显示名称 |
| `header_gradient` | 头部渐变色 |
| `primary` / `primary_light` | 主色 / 主色浅色 |
| `high_risk` / `medium_risk` / `healthy` | 风险等级颜色 |
| `score_thresholds` | 评分阈值：`excellent`(≥90) / `good`(≥80) / `warning`(≥70) / `danger` |
| `score_excellent` / `score_good` / `score_warning` / `score_danger` | 各阈值对应的评分颜色 |
| `risk_thresholds` | 风险预警阈值：`high_risk_alert` / `medium_risk_alert` / `healthy_ratio_good` |
| `layout` | 布局参数：宽度、圆角、字号等 |
| `chart` | 图表参数：宽高、线宽等 |
| `modules_order` | 报告模块排列顺序 |

### 自定义模板规则

- `references/plugins/tas-risk/template/default/` 目录为内置模板，**不允许覆盖**
- 用户修改模板后通过 `--save-template <名称>` 保存到 `template/<名称>/` 目录
- 下次使用 `--template <名称>` 即可加载自定义模板生成报告

## 架构图缩略图渲染

报告中的架构图缩略图使用 JSON 数据中 `riskTrend.Svg` 字段的 SVG 字符串直接渲染，通过 CSS `width:100%; height:auto` 实现自适应缩放。

## AI 分析报告规范

生成 **简洁专业** 的中文报告分析文本（200-400字），内容包括：

- 整体健康度评价（基于评分和风险数）
- 风险变化趋势分析（较上周对比）
- 重点风险产品/领域提醒
- 五大维度中的薄弱项指出
- 优化建议（1-3条关键建议）

分析文本支持简单的 Markdown 格式：`## 标题`、`### 子标题`、`- 列表项`、`**加粗**` 和普通段落。
