# 伴生产品触发词词典

> **被引用方**：[`how-to-identify-companion-products.md`](../../how-to-identify-companion-products.md) §B.2 主算法
>
> **强制清单（命中即拆，无例外）+ 可选清单（AI 判断 + 标注 inferred）**

## 强制清单（命中即拆出独立 SPU 行）

| token | 拆出的腾讯云产品名 | 适用 site | 来源 | 启用 |
|-------|-------------------|----------|------|------|
| 系统盘 | 云硬盘 CBS（系统盘） | cn,intl | CVM 必带 | yes |
| 数据盘 | 云硬盘 CBS（数据盘） | cn,intl | CVM 可选附加 | yes |
| 根盘 | 云硬盘 CBS（系统盘别名） | cn,intl | 通用别名 | yes |
| 云硬盘 | 云硬盘 CBS | cn,intl | 直接产品名 | yes |
| CBS | 云硬盘 CBS | cn,intl | 缩写 | yes |
| EBS | 云硬盘 CBS（友商→腾讯云对标） | cn,intl | AWS 磁盘服务 | yes |
| ESSD | 云硬盘 CBS（友商→腾讯云对标） | cn,intl | 阿里云磁盘类型 | yes |
| Persistent Disk | 云硬盘 CBS（友商→腾讯云对标） | cn,intl | GCP 磁盘 | yes |
| 公网带宽 | 公网带宽 / 弹性公网 IP（按带宽阈值分流，见 how-to-identify-companion-products.md 规则 2） | cn,intl | CVM 公网附加 | yes |
| 弹性公网 IP | 弹性公网 IP | cn,intl | 独立 SPU | yes |
| 弹性公网 | 弹性公网 IP | cn,intl | 简写 | yes |
| EIP | 弹性公网 IP | cn,intl | 缩写 | yes |
| 公网 IP | 弹性公网 IP | cn,intl | 通称 | yes |
| PublicIP | 弹性公网 IP | cn,intl | 友商字段名 | yes |
| 带宽包 | 共享带宽包 | cn,intl | 独立 SPU | yes |
| 共享带宽包 | 共享带宽包 | cn,intl | 全名 | yes |
| BWP | 共享带宽包 | cn,intl | 缩写 | yes |
| 共享流量包 | 共享流量包 | cn,intl | 独立主行（见易混淆场景 B） | yes |
| NAT 网关 | NAT 网关 | cn,intl | 独立 SPU | yes |
| NAT Gateway | NAT 网关 | cn,intl | English | yes |
| VPN 网关 | VPN 网关 | cn,intl | 独立 SPU | yes |
| 专线 | 专线接入 | cn,intl | 独立 SPU | yes |
| Direct Connect | 专线接入 | cn,intl | English / 友商对标 | yes |
| IPv6 | 公网 IPv6 | cn,intl | 独立 SPU | yes |
| 公网 IPv6 | 公网 IPv6 | cn,intl | 全名 | yes |
| 静态 IP | 弹性公网 IP（静态） | cn,intl | 别名 | yes |

## 可选清单（AI 判断 + 标注 `companion_inferred=yes`）

| token | 拆出的腾讯云产品名 | 是否默认拆 | 适用 site | 来源 | 启用 |
|-------|-------------------|-----------|----------|------|------|
| 快照 | 云硬盘快照 | 视上下文 | cn,intl | 用户可能默认包含 | yes |
| 备份 | 云数据库备份 | 视上下文 | cn,intl | DB 类附加（多数 DB 备份独立计费） | yes |
| 监控 | 云监控 CM | 视上下文 | cn,intl | 多数情况免费 | yes |
| 安全组 | 安全组（免费） | 不拆 | cn,intl | 一般不计费 | yes |
| 日志服务 | 日志服务 CLS | 视上下文 | cn,intl | 独立 SPU | yes |
| Observability | 可观测平台 | 视上下文 | cn,intl | 独立 SPU | yes |
| 防火墙 | 云防火墙 CFW | 视上下文 | cn,intl | 独立 SPU | yes |
| WAF | Web 应用防火墙 WAF | 视上下文 | cn,intl | 独立 SPU | yes |

## 与字典词条的协同

- 本词典只列**触发词**和**目标产品名**
- 具体的腾讯云磁盘类型选择（如阿里云 ESSD PL0 → 腾讯云 Enhanced SSD）由：
  - **Phase 1**：[`implicit-spec-disk.md`](./implicit-spec-disk.md) 做初步推断（待用户确认）
  - **Phase 2 Winback**：`cloud-mapping[-intl]` 字典做权威映射

详细拆分规则、易混淆场景、反模式见 [`how-to-identify-companion-products.md`](../../how-to-identify-companion-products.md)。
