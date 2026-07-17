# 默认属性词典

> **类目**：DEFAULT_ATTR（命中后**进 `约束条件` 列**，不进搜索词；这些是产品的默认属性，写进搜索词反而会让搜索失败）

| token | 归类 | 适用 site | 适用产品类目 | 来源 | 启用 |
|-------|------|----------|-------------|------|------|
| CPU 独享 | DEFAULT_ATTR | cn,intl | 云服务器 CVM | 标准型默认属性（共享型才特殊） | yes |
| CPU独享 | DEFAULT_ATTR | cn,intl | 云服务器 CVM | 标准型默认属性 | yes |
| 独享型 | DEFAULT_ATTR | cn,intl | 云服务器 CVM | 标准型默认 | yes |
| X86 | DEFAULT_ATTR | cn,intl | 云服务器 CVM | 标准型默认架构 | yes |
| X86 架构 | DEFAULT_ATTR | cn,intl | 云服务器 CVM | 标准型默认架构 | yes |
| x86_64 | DEFAULT_ATTR | cn,intl | 云服务器 CVM | 标准型默认架构 | yes |
| IPv4 | DEFAULT_ATTR | cn,intl | 云服务器 CVM,公网 IP,弹性公网 IP | 默认 IP 协议 | yes |
| 公网 | DEFAULT_ATTR | cn,intl | 公网带宽,弹性公网 IP | 默认网络类型 | yes |
| 标准 SLA | DEFAULT_ATTR | cn,intl | * | 默认 SLA 等级 | yes |
| 99.95% | DEFAULT_ATTR | cn,intl | * | 默认可用性 SLA | yes |
| 单可用区 | DEFAULT_ATTR | cn,intl | 云服务器 CVM,云数据库 MySQL | 默认部署模式（多可用区才特殊） | yes |
| 主从架构 | DEFAULT_ATTR | cn,intl | 云数据库 MySQL,云数据库 PostgreSQL | MySQL 默认架构（高可用版默认） | yes |
| 同步复制 | DEFAULT_ATTR | cn,intl | 云数据库 MySQL,云数据库 PostgreSQL | MySQL 默认复制模式 | yes |
| InnoDB | DEFAULT_ATTR | cn,intl | 云数据库 MySQL | MySQL 默认存储引擎 | yes |
| UTF-8 | DEFAULT_ATTR | cn,intl | 云数据库 MySQL,云数据库 PostgreSQL | 默认字符集 | yes |
| utf8mb4 | DEFAULT_ATTR | cn,intl | 云数据库 MySQL | MySQL 默认字符集 | yes |

> ⚠️ 默认属性识别后**默认进 `约束条件` 列做记录**（保留信息），不进搜索词。如确认这些是用户**特别强调的硬约束**（不只是默认值），可在阶段 D 询问后改成 PERFORMANCE_FILTER 或保留在约束条件列。
