# 用法样例 recipes/

> **定位**：面向**前端工程师 / BI 看板搭建者**，给出"卡片级 SQL 拼装"的实战样例。
> **不是指标定义**：本目录下的 SQL 只是"如何把多个原子/复合指标组合起来一次取出"的实战拼装，**不应被引用为指标定义**。

## 招活-社招 4 张卡片样例

| 卡片 | 文件 | 包含指标 |
| --- | --- | --- |
| **A 卡片**：需求与漏斗概览 | [`recruit-social/card-A-demand-overview.md`](./recruit-social/card-A-demand-overview.md) | 12 项 |
| **B 卡片**：环节通过/进度数量 | [`recruit-social/card-B-funnel-counts.md`](./recruit-social/card-B-funnel-counts.md) | 11 项 |
| **C 卡片**：漏斗通过率 | [`recruit-social/card-C-funnel-rates.md`](./recruit-social/card-C-funnel-rates.md) | 9 项 |
| **D 卡片**：辅助指标 | [`recruit-social/card-D-helper.md`](./recruit-social/card-D-helper.md) | 12 项 |

## 治理约定

1. **卡片 ≠ 指标分组**：卡片只是 UI 排版，指标本身仍然在 `atomic/` `composite/` `derived/` 中定义
2. **拼装层不引入新口径**：如果某个卡片需要的指标不在原子/复合/派生中，不能在 recipes/ 中"就地定义"，**必须先回到上层登记**
3. **拼装样例的版本化**：4 张卡片的 SQL 随产品迭代会变，但只要原子指标稳定，拼装层的修改成本很低
