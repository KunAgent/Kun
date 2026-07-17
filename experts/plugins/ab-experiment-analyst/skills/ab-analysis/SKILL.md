---
name: ab-analysis
description: "AB实验分析主链路：场景路由（对齐/新指标/下钻+Bonferroni）、参数化SQL生成、统计显著性检验、5段式结构化报告输出。仅通过 /mobility-ab-analysis 显式斜杠命令触发。"
delegate_to: "ab-analysis"
---

# ab-analysis（委托）

本 skill 为专家包内置桩文件，实际能力由全局 skill `ab-analysis` 提供。

## 使用方式

当专家识别到 AB 实验分析请求时，加载全局 `ab-analysis` skill 执行完整工作流：
1. 场景识别（A: 对齐已有指标 / B: 新指标构建 / C: 下钻+Bonferroni）
2. 输入收集（exp_id + 观测窗口 + 对比版本 + 指标名）
3. 指标元信息获取
4. SQL 生成（对齐 SQL + 统计量 SQL）
5. 执行取数 + 统计检验
6. 5 段式报告输出 + 归档

## 铁律

- 口径先于 SQL，对齐先于显著性
- 多重检验必须校正
- 异常值必须标注
- 分析必归档
