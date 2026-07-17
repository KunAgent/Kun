# 逻辑修饰词词典

> **类目**：MODIFIER（**单独出现时丢弃**；与性能指标组合时升格为 PERFORMANCE_FILTER）

| token | 归类 | 单独出现 | 与性能指标组合 | 来源 | 启用 |
|-------|------|---------|---------------|------|------|
| 不低于 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER（如 "不低于 1800 IOPS"） | 范围比较词（下界） | yes |
| 至少 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 范围比较词（下界） | yes |
| ≥ | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 数学符号 | yes |
| >= | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 数学符号 ASCII | yes |
| 大于 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 范围比较词（开区间） | yes |
| 不超过 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 范围比较词（上界） | yes |
| 至多 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 范围比较词（上界） | yes |
| ≤ | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 数学符号 | yes |
| <= | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 数学符号 ASCII | yes |
| 小于 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 范围比较词（开区间） | yes |
| 优先 | MODIFIER | 丢弃 | 与产品族组合 → 进 `约束条件` 列 | 偏好词 | yes |
| 推荐 | MODIFIER | 丢弃 | - | 偏好词 | yes |
| 最好 | MODIFIER | 丢弃 | - | 偏好词 | yes |
| 倾向 | MODIFIER | 丢弃 | - | 偏好词 | yes |
| 基于 | MODIFIER | 丢弃 | - | 介词（"基于 X86 架构"中的"基于"） | yes |
| 及以上 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER（如 "基频 2.5GHz 及以上"） | 范围比较词后缀 | yes |
| 及以下 | MODIFIER | 丢弃 | 升格 PERFORMANCE_FILTER | 范围比较词后缀 | yes |

### 性能指标识别（与 MODIFIER 组合升格为 PERFORMANCE_FILTER）

以下是常见的"性能指标"，与 MODIFIER 组合时整体应识别为 PERFORMANCE_FILTER：

| 性能指标 | 单位 | 适用产品 |
|---------|------|---------|
| IOPS | 次/秒 | 云硬盘 CBS,云数据库 MySQL |
| QPS | 次/秒 | 云数据库 Redis,云数据库 MySQL |
| TPS | 事务/秒 | 云数据库 MySQL |
| 吞吐 / 吞吐量 | MB/s, GB/s | 云硬盘 CBS,网络相关产品 |
| 延迟 | ms, μs | 各类性能敏感产品 |
| 主频 / 基频 | GHz | 云服务器 CVM |
| 带宽 | Mbps, Gbps | 公网带宽,负载均衡 CLB |
| 连接数 / 并发数 | 数值 | 负载均衡 CLB,云数据库 |
| 节点数 / 副本数 / 分片数 | 数值 | 集群类产品 |

> 例子：
>
> - `不低于 1800 IOPS` → 整体识别为 PERFORMANCE_FILTER → 进 `约束条件` 列
> - `基频 2.5 GHz 及以上` → 整体识别为 PERFORMANCE_FILTER → 进 `约束条件` 列
> - 单纯的 `不低于`（无性能指标） → MODIFIER → 丢弃
