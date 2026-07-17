# 伴生产品识别策略（Phase 1 阶段 B.2 子规则）

> **定位**：本文件由 [how-to-parse-product-list.md](./how-to-parse-product-list.md) 在 Phase 1 阶段 B.2（行结构展开 · 伴生拆分）引用。任何输入清单（腾讯云 / 友商 / 混合）解析时，主产品行内出现以下信号词时，必须拆出对应的腾讯云独立 SPU 作为独立行，写入 Phase 1 临时清单。
>
> **为什么放在 Phase 1**：伴生 SPU 在腾讯云是独立产品节点，必须独立成行才能在 Phase 5 `row add` 时被写入报价单。把识别推迟到 Phase 2（Winback）或 Phase 2.5 会导致信息已经被压在主产品配置摘要里，下游救不回来。识别规则与"友商 vs 腾讯云"无关，所以放在 Phase 1 统一做。
>
> **触发词字典**：触发词清单的**机读字典**位于 [`data/phase1-token-dict/companion-trigger.md`](./data/phase1-token-dict/companion-trigger.md)。Phase 1 主算法 B.2 步**直接读字典**做触发判断；本文档保留**拆分规则的语义说明 + 易混淆场景 + 反模式**，与字典互补。新增触发词时**先入字典**，再补本文档（如需要新增易混淆 case）。

## 总则

- **拆与不拆的判定依据**：cloud-mapping `product-strategy.md` 和 `field-rule.md`
  - 友商字段被 cloud-mapping 字典列为**独立产品维度**（如 CBS / EIP / BWP）→ **拆**
  - 友商字段被 cloud-mapping 字典映射到**主产品自身字段**（如 RDS `DiskSize → Volume`）→ **不拆**
- **识别 ≠ 映射**：Phase 1 只识别"这里有一个独立 SPU"，具体规格映射（ESSD PL0 → CLOUD_BSSD 等）由 Phase 2 Winback / cloud-mapping 字典负责
- **保守原则**：只有在主产品配置摘要中**字面出现信号词**时才拆，禁止凭 LLM 知识自动补齐用户没写的伴生产品

---

## ✅ 必须拆出的伴生 SPU（正规则）

### 规则 1：计算实例的存储 → 云硬盘 CBS

| 项 | 内容 |
|---|---|
| 触发主产品 | CVM / ECS / EC2 / GCE / 华为云 ECS / 物理机 / 裸金属云服务器（BM/BMS） |
| 触发信号词 | `系统盘` / `数据盘` / `根盘` / `云硬盘` / `CBS` / `SSD` / `HDD` / `ESSD` / `EBS` / `Category` / `VolumeType` / `DiskType` / `gp2` / `gp3` / `io1` / `io2` / `st1` / `sc1` / `pd-standard` / `pd-balanced` / `pd-ssd` / `pd-extreme` / `GPSSD` / `SAS` / `SATA` |
| 拆出 SPU | 云硬盘 CBS — **系统盘和数据盘必须分别拆成两行**（腾讯云对系统盘/数据盘有独立的容量限幅：50-2048GB / 20-32000GB） |
| 字典依据 | `field-rule.md` CBS 行（阿里云 Category / AWS VolumeType / GCP DiskType / 华为云 VolumeType 都映射到独立 CBS DiskType）；`product-strategy.md` 阿里云/华为云/AWS/GCP CBS 行 |

**示例**：

```
输入：阿里云 ECS  c8i 8vCPU 16GiB / 系统盘 ESSD PL0 100GB / 数据盘 ESSD 100GB

Phase 1 拆出 3 行：
  1. 阿里云 云服务器 ECS    | c8i / 8vCPU 16GiB                  | 主产品
  2. 阿里云 ECS 系统盘      | ESSD PL0 / 100GB                   | 伴生 (规则 1)
  3. 阿里云 ECS 数据盘      | ESSD（无 PL 标注）/ 100GB          | 伴生 (规则 1)
```

### 规则 2：计算实例的公网 → EIP / BWP / 共享流量包

| 项 | 内容 |
|---|---|
| 触发主产品 | CVM / ECS / EC2 / GCE / 华为云 ECS |
| 触发信号词 | `公网IP` / `EIP` / `弹性公网` / `PublicIP` / `公网带宽` / `BGP` / `公网流量` / `带宽峰值 N Mbps` |
| 拆出 SPU 分流 | 按带宽和形态判断：<br>① 单 IP 带宽 **≤ 200Mbps** + `按量/按流量/包月带宽` → **弹性公网 IP（EIP）**<br>② 单 IP 带宽 **> 200Mbps** 或 **多 IP 共享** → **共享带宽包（BWP）**<br>③ 信号词出现 `流量包` / `共享流量包` / `亚太全时` → **共享流量包**（独立主行而非伴生，见"易混淆"） |
| 字典依据 | `range-mapping.md` `eip_bw_postpaid (阿里云): 0~200Mbps`、`eip_bw_package (阿里云): 0~2000Mbps`；`field-rule.md` EIP 行；`product-strategy.md` 阿里云/华为云 EIP 行 |

**示例**：

```
输入：CVM 标准型 S5 / 系统盘 50GB / 公网带宽 10Mbps 按流量

Phase 1 拆出 3 行：
  1. CVM 标准型 S5         | 主产品
  2. CVM 系统盘             | 50GB SSD                | 伴生 (规则 1)
  3. 弹性公网 IP            | 按流量 10Mbps           | 伴生 (规则 2，10≤200Mbps)
```

```
输入：阿里云 ECS / 公网带宽 1000Mbps 共享带宽包

Phase 1 拆出：
  1. 阿里云 云服务器 ECS    | 主产品
  2. 共享带宽包             | 1000Mbps                | 伴生 (规则 2，>200Mbps，走 BWP)
```

> Phase 2 Winback / cloud-mapping 可以根据更精确的字典数据**修正**带宽阈值判断；Phase 1 只做粗判，不要在此阶段反复纠结。

---

## ❌ 不拆的内部参数（反规则 — 防误判）

下列产品的"看起来像伴生"的字段，在腾讯云属于主产品自身的内部参数，**禁止拆出独立行**：

| 主产品 | 看似伴生但属主产品内部参数 | 字典依据（`field-rule.md`） |
|---|---|---|
| 数据库 MySQL / PostgreSQL / SQLServer / TDSQL-C | `DiskSize` / `存储` / `Volume` / `AllocatedStorage` | MySQL/PG/SQLServer/TDSQLC `DiskSize → Volume`（主产品字段） |
| MongoDB | `DiskSize` / `存储` / `Volume` | `DiskSize → Volume` |
| Redis | `Capacity` / `Memory` / `分片数` / `副本数` | `Capacity → Memory`（架构内部参数） |
| 消息队列 CKafka / Kafka / RocketMQ / TDMQ | `DiskSize` / `存储` / `Bandwidth` | `DiskSize → DiskSize`（主产品字段） |
| Elasticsearch | `EBSVolumeSize` / `节点磁盘` | `EBSVolumeSize → DiskSize` |
| 对象存储 COS / OSS / S3 / OBS | `StorageSize` / `存储大小` | `StorageSize → StorageSize`（主产品字段） |
| 文件存储 CFS / NAS / EFS / Filestore | `Protocol` / `StorageType` / `存储大小` | 主产品 `StorageType / Protocol` |
| 负载均衡 CLB（共享型，带宽 ≤ 2048Mbps） | `BandwidthLimit` | `BandwidthLimit → BandwidthLimit/SpecType`（主产品规格） |
| NAT 网关 | `OutBandwidthLimit` / `出带宽` | `BandwidthLimit → OutBandwidthLimit` |
| VPN 网关 | `BandwidthSize` / `带宽` | `BandwidthSize → BandwidthSize` |

---

## ⚠️ 易混淆场景

### 场景 A：CLB 性能容量型 + 公网带宽 > 2048Mbps

CLB 共享型上限 2048Mbps，超过此阈值的部分需要 BWP 配合。

```
输入：CLB 性能容量型 / 公网带宽 5000Mbps

Phase 1 拆出：
  1. 负载均衡 CLB           | 性能容量型              | 主产品
  2. 共享带宽包             | 5000Mbps                | 伴生（CLB 主产品带不动，需 BWP 配合）
```

字典依据：`product-strategy.md` 阿里云 CLB 行 + `range-mapping.md` `clb_bw_shared (阿里云): 0~2048Mbps`。

### 场景 B：资源包 / 流量包是独立主行而非伴生

- 阿里云"OSS 标准存储包" / 阿里云"共享流量包" / AWS DataTransfer
- 它们已经是清单里的**独立一行**，不是某个主产品的伴生
- ❌ 不要在 OSS / EIP 配置摘要里写"+1TB 资源包"，应当独立成行
- ✅ 字典未直接覆盖这类资源包，由 cpq 主流程的 Phase 2 / migraq 兜底处理

---

## 与 Winback 的协同

Phase 1 已识别的伴生行进入下游：

- **腾讯云清单** → 直接进 Phase 2.5（产品名规范化）
- **友商清单** → 进 Phase 2 Winback：
  - **CBS 伴生行**：cloud-mapping `field-rule.md` CBS 维度直接处理（`Category / VolumeType / DiskType` → 腾讯云 `DiskType`；`Size` → 系统盘/数据盘容量限幅）
  - **EIP / BWP 伴生行**：`field-rule.md` EIP 维度处理（`TotalBandwidth → BandwidthLimit`、`NetChargeType → EIPChargeType`）
  - **主产品行**：实例族映射

伴生行与主产品行使用**相同的来源判断**（同为"腾讯云"或同为"友商"）。

---

## 反模式

- ❌ 把"系统盘 SSD 100GB"塞在 CVM 主行的配置摘要里不拆 → Phase 5 `row add` 时 CBS 漏掉
- ❌ 把 RDS / Redis / Kafka 的 `DiskSize` / `存储 N GB` 拆成 CBS → 错误（这些都是主产品的 `Volume / DiskSize` 内部参数）
- ❌ 用 LLM 知识自动补"用户没写的伴生产品"（如用户没提公网带宽，就不要凭"实例总要绑 EIP 吧"补一行 EIP）
- ❌ 在 Phase 2 / Phase 2.5 阶段才补救识别（识别与映射应解耦：Phase 1 识别，Phase 2 映射）

---

## 维护说明

新增伴生规则的判定流程：

1. 查 `cloud-mapping/references/data/cloud-mapping/product-strategy.md` 是否把该字段列为独立产品维度（如 `阿里云 XYZ (XYZ→XYZ) ...`）
2. 查 `cloud-mapping/references/data/cloud-mapping/field-rule.md` 是否将该源字段映射到独立产品的字段，而非主产品自身字段
3. 同时满足 (1) 或 (2) → 加入正规则；否则加入反规则
4. **新增触发词时**：先在 [`data/phase1-token-dict/companion-trigger.md`](./data/phase1-token-dict/companion-trigger.md) 字典加一行（append-only），再补本文档语义说明（如需要新增易混淆 case）

## Phase 1 阶段 B.2 执行步骤

> 本节是 [`how-to-parse-product-list.md`](./how-to-parse-product-list.md) 阶段 B.2 的执行细则。

```
对每个主产品行 R:
  1. 加载 data/phase1-token-dict/companion-trigger.md（按 site 过滤）
  2. 扫描 R.规格/子类型 + R.约束条件 中的所有 token
  3. 命中【强制清单】触发词 → 拆出独立行 R':
     - R'.row_id = max(已分配 row_id) + 1
     - R'.产品名 = 字典 "拆出的腾讯云产品名" 列
     - R'.规格 = 类型 + 容量（如 "SSD 系统盘 40GB"）
     - R'.站点 / 地域 / 售卖模式 / 优惠策略 / 来源判断 = 继承 R
     - R'.status = stable（初次落盘）/ dirty（局部更新场景）
  4. 命中【可选清单】触发词 → 拆出独立行 + 在 推断标记 列写 companion_inferred=yes
  5. 主产品行 R 移除已拆出的 token（搜索关键词重新构造）
  6. 累计 companion_expanded 计数
```

完成后填入 phase1-done：

```
companion_expanded=<C>
step_companion_expanded=<yes|n/a>
```

`step_companion_expanded=yes` 仅当 companion_expanded > 0；否则填 `n/a`。
