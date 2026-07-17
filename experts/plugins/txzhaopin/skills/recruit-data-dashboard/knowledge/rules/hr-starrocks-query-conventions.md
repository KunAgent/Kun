---
name: hr-starrocks-query-conventions
type: always
description: HR数仓StarRocks查询约定。任何生成或审查HR数仓SQL的场景都必须遵守本规则。
---

# HR 数仓 StarRocks 查询约定

本规则定义了查询 HR 数仓 StarRocks 时必须遵守的数据模型和架构约定。**始终生效**，无论是否加载了任何 Skill。

## 强制约束

### 1. 禁止添加权限控制类 WHERE 条件

- StarRocks 已实现**基于用户身份的行列权限自动控权**
- **严禁**为权限控制目的添加 WHERE 条件（如按组织ID、员工类型过滤来限制数据可见范围）
- WHERE 子句**仅用于业务查询需求**（如用户明确要求查看某个部门、某类员工）
- 违反此规则会导致重复控权，引发数据异常（如数据缺失、统计不准确）
