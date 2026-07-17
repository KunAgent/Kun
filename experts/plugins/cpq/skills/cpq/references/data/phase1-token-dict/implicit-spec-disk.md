# 隐式磁盘规格词典（推断映射 · 必须用户确认）

> **类目**：IMPLICIT_SPEC（命中后**仅在用户确认后才进搜索词**）
>
> **加载条件**：cn / intl 通用
>
> **典型场景**：友商迁移清单中出现友商专有磁盘规格（如阿里云 ESSD PL0 / AWS gp3），AI 推断对应腾讯云磁盘类型，但用户必须确认（避免凭过期映射误推）。

| token | 归类 | 推断目标 | 适用 site | 适用产品类目 | 来源 | 启用 |
|-------|------|---------|----------|-------------|------|------|
| ESSD PL0 | IMPLICIT_SPEC | 云硬盘 CBS Enhanced SSD | cn,intl | 云硬盘 CBS | 阿里云 ESSD 性能级别 → 腾讯云对标 | yes |
| ESSD PL1 | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | 阿里云 ESSD 性能级别 → 腾讯云对标 | yes |
| ESSD PL2 | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | 阿里云 ESSD 性能级别 | yes |
| ESSD PL3 | IMPLICIT_SPEC | 云硬盘 CBS Enhanced SSD | cn,intl | 云硬盘 CBS | 阿里云 ESSD 最高级别 | yes |
| gp2 | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | AWS EBS gp2 → 腾讯云对标 | yes |
| gp3 | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | AWS EBS gp3 → 腾讯云对标 | yes |
| io1 | IMPLICIT_SPEC | 云硬盘 CBS Enhanced SSD | cn,intl | 云硬盘 CBS | AWS EBS io1 → 腾讯云对标 | yes |
| io2 | IMPLICIT_SPEC | 云硬盘 CBS Enhanced SSD | cn,intl | 云硬盘 CBS | AWS EBS io2 → 腾讯云对标 | yes |
| st1 | IMPLICIT_SPEC | 云硬盘 CBS HDD | cn,intl | 云硬盘 CBS | AWS EBS st1（吞吐型 HDD） | yes |
| sc1 | IMPLICIT_SPEC | 云硬盘 CBS HDD | cn,intl | 云硬盘 CBS | AWS EBS sc1（冷 HDD） | yes |
| pd-ssd | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | GCP Persistent Disk SSD | yes |
| pd-balanced | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | GCP Persistent Disk Balanced | yes |
| pd-extreme | IMPLICIT_SPEC | 云硬盘 CBS Enhanced SSD | cn,intl | 云硬盘 CBS | GCP Persistent Disk Extreme | yes |
| pd-standard | IMPLICIT_SPEC | 云硬盘 CBS HDD | cn,intl | 云硬盘 CBS | GCP Persistent Disk Standard (HDD) | yes |
| GPSSD | IMPLICIT_SPEC | 云硬盘 CBS Premium SSD | cn,intl | 云硬盘 CBS | 华为云 GPSSD（通用 SSD） | yes |
| ESSD（华为云） | IMPLICIT_SPEC | 云硬盘 CBS Enhanced SSD | cn,intl | 云硬盘 CBS | 华为云 ESSD | yes |
| SAS | IMPLICIT_SPEC | 云硬盘 CBS HDD | cn,intl | 云硬盘 CBS | 华为云 SAS（机械） | yes |
| SATA | IMPLICIT_SPEC | 云硬盘 CBS HDD | cn,intl | 云硬盘 CBS | 通用 HDD 接口类型 | yes |

> 与 `cloud-mapping` 字典的 `field-rule.md` CBS 行**重叠时优先以 cloud-mapping 为准**。本词典只用于 Phase 1 的"先识别后让用户确认"，最终的腾讯云 SKU 选择仍由 Phase 2 Winback 走 cloud-mapping 字典做权威映射。
