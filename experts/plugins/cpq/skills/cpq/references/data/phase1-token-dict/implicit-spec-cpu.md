# 隐式 CPU 规格词典（推断映射 · 必须用户确认）

> **类目**：IMPLICIT_SPEC（命中后**仅在用户确认后才进搜索词**，否则只在 `推断标记` 列留痕）
>
> **加载条件**：cn / intl 通用
>
> **决策依据**：决策 1.2 = B 中（仅对会改变 SPU ID 的推断追问）

| token | 归类 | 推断目标 | 适用 site | 适用产品类目 | 来源 | 启用 |
|-------|------|---------|----------|-------------|------|------|
| Ice Lake | IMPLICIT_SPEC | CVM 标准型 S6 | cn,intl | 云服务器 CVM | Intel 第三代 Xeon Scalable (2021) | yes |
| Ice Lake-SP | IMPLICIT_SPEC | CVM 标准型 S6 | cn,intl | 云服务器 CVM | Intel Ice Lake 别名 | yes |
| Cascade Lake | IMPLICIT_SPEC | CVM 标准型 S5 | cn,intl | 云服务器 CVM | Intel 第二代 Xeon Scalable (2019) | yes |
| Sapphire Rapids | IMPLICIT_SPEC | CVM 标准型 S8 | cn,intl | 云服务器 CVM | Intel 第四代 Xeon Scalable (2023) | yes |
| Skylake | IMPLICIT_SPEC | CVM 标准型 S4 | cn,intl | 云服务器 CVM | Intel 第一代 Xeon Scalable (2017) | no |
| EPYC Milan | IMPLICIT_SPEC | CVM 标准型 SA3 | cn,intl | 云服务器 CVM | AMD EPYC 7003 (2021) | yes |
| Milan | IMPLICIT_SPEC | CVM 标准型 SA3 | cn,intl | 云服务器 CVM | AMD EPYC Milan 简称 | yes |
| EPYC Genoa | IMPLICIT_SPEC | CVM 标准型 SA5 | cn,intl | 云服务器 CVM | AMD EPYC 9004 (2022) | yes |
| Genoa | IMPLICIT_SPEC | CVM 标准型 SA5 | cn,intl | 云服务器 CVM | AMD EPYC Genoa 简称 | yes |
| EPYC Rome | IMPLICIT_SPEC | CVM 标准型 SA2 | cn,intl | 云服务器 CVM | AMD EPYC 7002 (2019) | no |
| Graviton | IMPLICIT_SPEC | - | cn,intl | * | AWS ARM 架构（无对应腾讯云规格） | no |
| Graviton2 | IMPLICIT_SPEC | - | cn,intl | * | AWS ARM 第二代（无对应腾讯云规格） | no |

> ⚠️ **重要约定**：`推断目标` 字段的内容**必须用户确认才进搜索关键词**（决策 1.2 中档）。AI 不允许跳过确认直接套用。
>
> 用户拒绝推断时：
>
> - 搜索关键词不含 `推断目标`
> - `推断标记` 列保留 `<原token>→<推断目标>（已拒绝）` 作为审计痕迹
> - 该约束作为 PERFORMANCE_FILTER 进 `约束条件` 列（如 "Ice Lake 或更新"）
