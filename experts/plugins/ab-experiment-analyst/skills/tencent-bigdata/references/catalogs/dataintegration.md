# DataIntegration 子系统 Skill 明细

> [WARN] **使用本 catalog 内任何子 skill 前，必须先读取该子 skill 的 `SKILL.md`**
>
> 本文档仅用于 **路由发现**：根据触发场景 / 关键词定位到目标子 skill 后，**必须再加载** `sub-skills/<子系统>/<skill-name>/SKILL.md`，了解完整的执行步骤、参数约束、两阶段流程与边界条件，再调用 CLI 命令或脚本。
>
> [FAIL] 严禁仅凭本文档列出的命令清单直接执行；catalog 描述通常省略关键参数与前置依赖，跳读会导致执行路径不准确。

### inlong-platform-diagnosis

- **目录**: `DataIntegration/inlong-platform-diagnosis/`
- **触发场景**: InLong 平台一站式诊断，包括集群健康状态（ping）、数据组（Group）详情与状态统计、数据流（Stream）详情与列表、Source/Sink 配置、审计日志、工作流任务日志、字段变更日志、操作日志、DataProxy IP 列表；以及 cpp/go/trpc/python/java 多语言数据上报 SDK 指引。
- **触发关键词**: InLong、InLong Manager、数据流组、GroupId、StreamId、Wedata数据上报
- **包含资源**:
  - 详见子 Skill SKILL.md

---

### tdbank-platform-diagnosis

- **目录**: `DataIntegration/tdbank-platform-diagnosis/`
- **触发场景**: TDBank 平台一站式诊断，查询业务接口列表与详情、入库配置、数据源详情、业务 ID（bid）详情、MQ 主题信息（TTL 生命周期、分区数量）以及 Pulsar/Tube 订阅关系；提供数据上报问题排查与 SDK 指引。
- **触发关键词**: TDBank、业务接口、bid、tid、入库配置、MQ 主题、Pulsar TTL、Tube TTL、TDBank数据上报、TDBus
- **包含资源**:
  - 详见子 Skill SKILL.md

---

### tubemq-diagnosis

- **目录**: `DataIntegration/tubemq-diagnosis/`
- **触发场景**: TubeMQ 消息队列诊断，专注消息积压、消费延迟、集群状态等问题。包括两类能力：① 本地 TubeMQ 客户端日志解析与多维度性能 / 时间线分析（`tubemq:log-analyze`）；② 通过 do_mcp API 获取消费组多时间快照指标，诊断消费滞后、心跳丢失、消费停滞、分区倾斜等（`tubemq:csm-metric`）。
- **触发关键词**: TubeMQ、TubeMQ 日志、消费组、消费滞后、消息积压、心跳丢失、分区倾斜、csm-metric
- **包含资源**:
  - 详见子 Skill SKILL.md

---

### pulsar-diagnosis

- **目录**: `DataIntegration/pulsar-diagnosis/`
- **触发场景**: Pulsar 消息系统订阅诊断，提供订阅关系、分区状态、消息堆积等核心指标查询与分析。包括订阅列表查询（`pulsar:subscription-list`）、订阅分区统计（`pulsar:partitioned-stats`）、完整滞后诊断并生成 Markdown 报告（`pulsar:diagnose`），覆盖订阅统计信息、滞后指标分析、消费者状态检查与配置参数验证。
- **触发关键词**: Pulsar、Pulsar 订阅、订阅滞后、消费滞后、消息堆积、receiverQueueSize、ackTimeout、unack
- **包含资源**:
  - 详见子 Skill SKILL.md
