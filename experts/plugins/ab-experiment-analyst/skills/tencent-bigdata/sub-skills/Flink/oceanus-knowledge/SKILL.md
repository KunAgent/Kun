---
name: oceanus-knowledge
description: Oceanus 知识库检索 sub-skill。当用户提问 Oceanus 平台使用方法、原理概念、最佳实践、配置说明、常见问题、入门指引、FAQ、文档查找、Flink connector 用法/Demo/代码示例等知识类问题，且当前 sub-skills（如 flink-yarn-perjob/oceanus-log-analyzer 等）没有现成答案时，通过 Knot MCP 检索官方知识库获取权威答案。触发关键词：Oceanus 文档、Oceanus 怎么用、Oceanus 是什么、如何配置、最佳实践、参数说明、FAQ、知识库、官方说明、原理、概念、入门、使用指引、Demo、示例代码、connector 用法、TubeMQ、Kafka、Pulsar、Hippo、Iceberg。
---

## 概述

通过 [Knot MCP](http://mcp.knot.woa.com/open/mcp) 检索 Oceanus 官方知识库，回答用户关于 Oceanus/Flink 平台的**知识类**问题：使用方法、原理概念、最佳实践、配置说明、FAQ、入门指引、**Connector API 用法、代码示例**等。

本 skill **不调用 REST API / 不操作平台**，通过 CLI 命令 `do-bigdata flink knowledge` 调用 Knot MCP 检索知识库 + 引用文档片段作答。

## 触发条件

**满足以下任一条件时触发**：

- 询问 Oceanus 平台 **怎么用 / 是什么 / 为什么**（原理、概念、定位）
- 询问 **使用方法 / 最佳实践 / 入门指引 / FAQ**
- 询问某个 **参数 / 配置项 / 字段** 的含义、推荐值、影响范围
- **编写 Flink 作业代码 / Demo / 示例**（涉及 connector API、SQL DDL、JAR 开发）
- **询问 connector 用法**（TubeMQ、Kafka、Pulsar、Hippo、HDFS、Iceberg、MySQL CDC 等）
- 当前其他 sub-skills **无法回答**的 Oceanus/Flink 相关知识问题
- 用户主动要求「查文档 / 查知识库 / 看官方说明」

**不触发**（路由到对应 skill）：

| 用户需求 | 应使用 |
|---|---|
| 诊断作业异常 / OOM / GC / Checkpoint 失败 / TM 容器 | `flink-yarn-perjob` |
| 启动/编译/停止失败的日志分析 | `oceanus-log-analyzer` |
| 查看/搜索作业列表 | `oceanus-job-list` |
| 监控指标 / TPS / 延迟 / 背压 | `oceanus-metrics-query` |
| 修改/创建/启停作业 | `oceanus-job-management` |
| 资源配额 / 集群资源 | `oceanus-resource-advisor` |
| 库表/UDF 元数据 | `oceanus-resource-management` |

> **核心区分**：其他 sub-skills → "动手操作"；本 skill → "知识、原理与代码示例"。

## 强制规则

> 以下规则适用于所有涉及代码生成、pom.xml 生成、connector 使用的场景。

1. **禁止凭记忆编造 connector API**：涉及 Flink connector 的代码编写，必须先检索知识库获取准确的类名、API、配置参数。

2. **必须使用天穹版本号**：生成 pom.xml / Maven 依赖时，必须使用天穹（tianqiong）版本号（带 `-tq-` 标识），禁止使用社区版本号（如 `1.15.4`）。

3. **禁止硬编码版本号**：每次生成 pom.xml 时，必须先检索知识库中最新的「发版记录」获取当前最新天穹版本号（keyword: `发版;版本`，domain: `oceanus`）。版本号会随版本迭代更新，绝对不能凭记忆或历史缓存使用旧版本号。

4. **Connector 统一使用天穹版本**：所有 flink-connectors（Kafka、TubeMQ、Pulsar、Hippo、HDFS、HBase、Redis 等）均使用天穹版本：
   - groupId: `com.tencent.flink`
   - 坐标格式: `com.tencent.flink:flink-connector-<name>:<版本号>`
   - 禁止使用社区版 `org.apache.flink:flink-connector-kafka` 等
   - 源码仓库：https://git.woa.com/flink/flink-connectors

5. **依赖顺序要求**：在 `<dependencies>` 中天穹版本依赖必须放在最前面，确保 Maven 优先解析。顺序：
   1. Flink 核心依赖（天穹版本）
   2. Flink connector 依赖（天穹版本，groupId: `com.tencent.flink`）
   3. 其他天穹平台相关依赖
   4. 社区依赖（如 Apache Commons、Guava 等第三方库）
   5. 测试依赖

6. **必须包含 Maven 仓库配置**：在 `<project>` 中添加 `<repositories>` 和 `<pluginRepositories>`，内容参考 https://iwiki.woa.com/p/1220082226?from=iWiki_search ，必须包含以下仓库：
   ```xml
   <repositories>
       <repository>
           <id>tianqiong-releases</id>
           <url>https://mirrors.tencent.com/repository/maven/tianqiong-releases</url>
           <releases><enabled>true</enabled></releases>
           <snapshots><enabled>false</enabled></snapshots>
       </repository>
       <repository>
           <id>tianqiong-snapshots</id>
           <url>https://mirrors.tencent.com/repository/maven/tianqiong-snapshots</url>
           <releases><enabled>true</enabled></releases>
           <snapshots><enabled>true</enabled></snapshots>
       </repository>
       <repository>
           <id>tencent_public</id>
           <url>https://mirrors.tencent.com/repository/maven/tencent_public/</url>
           <releases><enabled>true</enabled></releases>
           <snapshots><enabled>false</enabled></snapshots>
       </repository>
       <repository>
           <id>thirdparty</id>
           <url>https://mirrors.tencent.com/repository/maven/thirdparty/</url>
           <releases><enabled>true</enabled></releases>
           <snapshots><enabled>false</enabled></snapshots>
       </repository>
       <repository>
           <id>central</id>
           <url>https://repo1.maven.org/maven2</url>
           <releases><updatePolicy>never</updatePolicy></releases>
           <snapshots><updatePolicy>never</updatePolicy></snapshots>
       </repository>
       <repository>
           <id>thirdparty-snapshots</id>
           <url>https://mirrors.tencent.com/repository/maven/thirdparty-snapshots/</url>
           <releases><enabled>false</enabled></releases>
           <snapshots><enabled>true</enabled></snapshots>
       </repository>
       <repository>
           <id>tencent-public-snapshot</id>
           <url>https://mirrors.tencent.com/repository/maven/tencent_public_snapshots</url>
           <releases><enabled>false</enabled></releases>
           <snapshots><enabled>true</enabled></snapshots>
       </repository>
   </repositories>
   <pluginRepositories>
       <pluginRepository>
           <id>public-plugin</id>
           <url>https://mirrors.tencent.com/repository/maven/tencent_public/</url>
           <releases><enabled>true</enabled></releases>
           <snapshots><enabled>false</enabled></snapshots>
       </pluginRepository>
       <pluginRepository>
           <id>thirdparty-plugin</id>
           <url>https://mirrors.tencent.com/repository/maven/thirdparty/</url>
           <releases><enabled>true</enabled></releases>
           <snapshots><enabled>false</enabled></snapshots>
       </pluginRepository>
   </pluginRepositories>
   ```

## MCP 配置（自动注入）

本 skill 依赖 Knot MCP，**无需用户手动配置**。`do-bigdata flink knowledge` 命令在执行时（Step 1）会自动将 MCP 配置幂等注入 `~/.codebuddy/mcp.json`（注入逻辑见 `do_cli/sub-cli/Flink/oceanus-knowledge/scripts/knowledge_search.py` 中的 `inject_mcp()` 函数）。

知识库 UUID：`ecde7202c88d482991bb3b52f9c8d861`

参考配置（自动注入内容）：

```json
{
  "mcpServers": {
    "knot": {
      "url": "http://mcp.knot.woa.com/open/mcp",
      "headers": {
        "x-knot-knowledge-uuids": "ecde7202c88d482991bb3b52f9c8d861",
        "x-knot-api-token": "fce1a110419a43608f21dd7005ed6bb9"
      }
    }
  }
}
```

**故障排查**：
- 如果 `do-bigdata flink knowledge` 报 MCP 连接失败，先确认上述 JSON 内容是否存在于 `~/.codebuddy/mcp.json`，缺失则手动写入
- 在 IDE 中点击 "Reload MCP Servers" 让配置生效

## 工作流

### Step 1: 路由判断

按「触发条件」表判断；属于动手操作类则转交对应 sub-skill，终止本 skill。

### Step 2: 通过 CLI 检索知识库

**调用方式**：通过 `do-bigdata flink knowledge` CLI 命令调用（内部自动执行 MCP 注入 + 检索）。

```bash
# 基础检索
do-bigdata flink knowledge --query "<用户问题>" --keyword "<关键词1>;<关键词2>"

# 指定检索域
do-bigdata flink knowledge --query "<用户问题>" --keyword "<关键词>" --domain oceanus

# 检索 connector 源码
do-bigdata flink knowledge --query "TubeMQ connector 用法" --keyword "TubeMQ;connector" --domain connector-1.15

# 检索发版记录（生成 pom.xml 时必须先查）
do-bigdata flink knowledge --query "最新发版版本号" --keyword "发版;版本;1.15" --domain oceanus
```

**CLI 参数说明**：

| 参数 | 说明 |
|---|---|
| `--query` | 语义检索问题主体（必填） |
| `--keyword` / `-k` | 关键词，多个用 `;` 分隔 |
| `--domain` / `-d` | 检索域，可选值见下表（不传则全局检索） |

**检索域选择**（`--domain` 参数值）：

| 用户问题类型 | --domain 值 | 对应 search_domain |
|---|---|---|
| Oceanus 使用方法 / 参数 / FAQ | `oceanus`（**默认首选**） | `averyzhang-e1c865f0c31a767237874e8099c4060b` |
| Iceberg 相关 | `iceberg` | `averyzhang-7fabe5b289a579a0a9ce80a7f34feaf7` |
| Flink 1.15 源码 | `flink-1.15` | `flink@flink-release-1.15` |
| Flink 2.1 源码 | `flink-2.1` | `flink@flink-release-2.1` |
| Connector 源码 (1.15) | `connector-1.15` | `flink@flink-connectors-release-1.15` |
| Connector 源码 (2.1) | `connector-2.1` | `flink@flink-connectors-release-2.1` |
| TAPD 需求/缺陷 | `tapd` | `5477a2c269faad84866e1957bb9d5c35` |
| 不确定时 | 不传 | 全局检索 |

**查询要点**：

- 保留用户原始措辞（语义检索更敏感）
- 必要时分多轮检索：更换同义词、拆解子问题、切换 search_domain
- 优先采纳带来源链接的片段（`href`/`doc_file_path`/`repo_path`）
- **生成代码/pom 场景**：必须额外检索最新发版记录（keyword: `发版;版本;1.15` 或 `发版;版本;2.1`，domain: `oceanus`），从返回的版本表中提取最新版本号

### Step 3: 整合答案

- 整合为结构化中文回答（标题 / 列表 / 表格）
- **必须标注来源**：每段引用注明文档标题或 URL
- 如有官方配置/命令示例，原样保留代码块
- 生成 pom.xml 时严格遵循「强制规则」章节的全部要求
- 未命中时**坦诚告知**，推荐可能相关的替代 sub-skill，**禁止编造**

## 限流与失败处理

> **[WARN] 强制规则**：MCP 累计失败超 3 次，必须立即停止，输出已收集信息 + 失败原因摘要。

| 失败现象 | 应对 |
|---|---|
| 连接失败 / DNS 解析失败 | 提示检查是否在公司内网 |
| `401` / `403` | 提示检查 `x-knot-api-token` 是否有效 |
| 返回空 / 无命中 | 改写 query 重试 1 次；仍空则告知未命中 |
| `429` | 立即停止，告知限流 |

## 使用示例

| 用户问题 | 处理方式 |
|---|---|
| 「Oceanus 是什么？」 | [OK] 触发，检索平台介绍文档 |
| 「Checkpoint 间隔推荐多少？」 | [OK] 触发，检索最佳实践文档 |
| 「帮我写 Flink 1.15 JAR Demo TubeMQ to Kafka」 | [OK] 触发，检索 TubeMQ/Kafka connector 源码获取准确 API，再基于检索结果编写代码 |
| 「Flink SQL 怎么写 Kafka source 表？」 | [OK] 触发，检索 Oceanus 手册中 Kafka connector DDL 示例 |
| 「Pulsar connector 有哪些配置参数？」 | [OK] 触发，检索 connector 源码或文档 |
| 「我的作业心跳超时了」 | [FAIL] 不触发，路由到 `flink-yarn-perjob` |

## 运维工具参考

> 所有工具均在智研运维平台（项目 ID: 542），地址格式：`https://zhiyan.woa.com/operate/542/task/#/task/result/{ID}`

### 告警屏蔽类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 46847 | Oceanus 告警屏蔽 | 对指定集群执行告警屏蔽，适用于集群维护、迁移、升级等场景 |
| 36722 | Oceanus 任务 failover 异常重启告警通知屏蔽 | 屏蔽指定任务的 failover 异常重启告警通知 |
| 36745 | 屏蔽：集群异常重启和 ck 失败 | 屏蔽集群级别的异常重启和 checkpoint 失败告警 |
| 39131 | Oceanus 任务 Checkpoint 失败异常告警通知屏蔽 | 屏蔽指定任务的 checkpoint 失败告警通知 |
| 13500 | [oc2] 支持告警模版 | Oceanus2 告警模版配置 |
| 45766 | [oc2] 批量复制告警配置 | 批量复制 Oceanus2 告警配置 |
| 24139 | oceanus 修改运维告警接受人 | 修改运维告警的接收人 |

### 批量重启 / 启停类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 13712 | oceanus 批量重启/批量启动 | 批量重启或启动 Oceanus 任务 |
| 13806 | 新加坡 oceanus 批量重启 | 新加坡环境批量重启 |
| 13809 | oceanus 修改集群批量重启-平台切换支持环境选择 | 修改集群后批量重启，支持按环境选择 |
| 14462 | oceanus 修改集群批量重启_集群异常强制设置失败-慎用 | 集群异常时强制设置失败后批量重启（慎用） |
| 18798 | oceanus 修改集群批量重启启动方式 sp/cp | 修改集群批量重启时选择从 savepoint 或 checkpoint 恢复 |
| 27655 | 推荐 oceanus1 修改集群批量重启 | Oceanus1 推荐的修改集群批量重启方式 |
| 29041 | oceanus 批量停止 | 批量停止 Oceanus 任务 |
| 29067 | oceanus 必需从 ck 恢复修改集群批量重启 | 强制从 checkpoint 恢复的集群迁移批量重启 |
| 41720 | oceanus 批量重启/批量启动-应用名称 tdsort | 针对 tdsort 应用的批量重启/启动 |

### 集群迁移类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 19152 | Oceanus2 迁移作业 Snapshots | Oceanus2 作业 snapshot 迁移 |
| 20940 | Oceanus2 同项目集群迁移作业-指定人执行 | 同项目内集群间迁移作业，指定人执行 |
| 21307 | 物理集群异常：oceanus 迁移应用组资源或迁移任务 | 物理集群异常时迁移应用组资源或任务 |
| 21329 | 物理集群异常：应用组分配资源后批量迁移任务 | 物理集群异常时分配资源后批量迁移 |
| 21713 | 逻辑集群异常：应用组分配资源后批量迁移任务 | 逻辑集群异常时分配资源后批量迁移 |
| 21714 | 逻辑集群异常：oceanus 迁移应用组资源或迁移任务 | 逻辑集群异常时迁移应用组资源或任务 |
| 23684 | oceanus 迁移集群强制设置迁移成功 | 强制将迁移状态设置为成功 |
| 24608 | oceanus 更新集群信息到迁移工具 | 刷新集群信息到迁移工具 |
| 45689 | Oceanus2 跨域名迁移作业 Snapshots-wxgpay | 跨域名迁移作业 snapshot（wxgpay 场景） |
| 46791 | 复制作业到指定新集群 | 复制作业到指定的新集群 |

### Checkpoint / Savepoint 类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 3536 | 根据集群清理所有 oceanus 任务的 cp 和 sp | 根据 HDFS 集群清理所有任务的 checkpoint 和 savepoint |
| 12455 | 清理废弃应用 checkpoint 和 savepoint | 清理已废弃应用的 cp/sp |
| 18385 | 清理废弃 flink15 版本 cp 和 sp-保留 2 次完成记录 | 清理 flink1.15 废弃 cp/sp，保留最近 2 次成功记录 |
| 15132 | oceanus 从指定 checkpoint 路径恢复--全量 checkpoint | 从指定 checkpoint 路径全量恢复任务 |
| 13890 | oceanus2 手动触发 savepoint | 手动触发 Oceanus2 任务的 savepoint |
| 14106 | oceanus2_fit 手动触发 savepoint | FIT 环境手动触发 savepoint |

### 作业管理类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 20059 | oceanus2 复制应用到其他项目 | 将 Oceanus2 应用复制到其他项目 |
| 19386 | OC2 SQL/画布任务原地升级到 1.15 且支持切换集群 | SQL/画布任务原地升级到 flink1.15 并支持切换集群 |
| 19465 | Oceanus 任务灰度垂直扩缩容（扩） | 灰度方式对任务进行垂直扩容 |
| 19592 | oceanus 垂直扩容 | Oceanus 任务垂直扩容 |
| 19887 | oceanus_jm_tm 预留内存只支持 yarn | 设置 JM/TM 预留内存（仅 yarn 模式） |
| 35542 | oceanus 应用设置不检查状态 | 设置应用跳过状态检查 |
| 43011 | 临时忽略异常停止检测 | 临时忽略指定应用的异常停止检测 |
| 14559 | 新加坡-pcg 应用修改项目 ID | 新加坡 PCG 环境修改应用所属项目 ID |
| 13336 | oceanus2 新加坡修改项目 defalut 修改应用组 | 新加坡环境修改项目默认应用组 |

### 诊断排查类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 16335 | oceanus 指标查看 | 查看 Oceanus 任务监控指标 |
| 16838 | 获取异常重启 jobs | 获取异常重启的作业列表 |
| 16938 | 查看集群时间段异常任务 | 查看指定集群在某时间段内的异常任务 |
| 16939 | 查看集群时间段异常任务--剔除已经正在运行 | 查看异常任务（排除已恢复运行的） |
| 17706 | 统计异常重启数-忽略用户的异常 | 统计异常重启次数（排除用户操作导致的） |
| 17923 | 根据异常重启告警--查看集群异常重启应用 | 根据告警查看集群异常重启的应用 |
| 18007 | 检查 oceanus 应用状态和 checkpoint 状态 | 检查应用运行状态和 checkpoint 健康状态 |
| 21226 | oceanus 集群异常信息 | 查看集群级别异常信息 |
| 21227 | oceanus 异常信息 | 查看 Oceanus 平台异常信息 |
| 37572 | oceanus2 查看应用 GC 容器 | 查看 Oceanus2 应用的 GC 容器信息 |

### 日志与容器类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 12291 | 查看 yarn contain 容器信息 | 查看 YARN container 容器详细信息 |
| 16375 | oceanus 根据 application id 保留日志和 dump/jstack | 根据 application id 保留日志和 dump/jstack（内部使用） |
| 17229 | oceanus 根据服务器和 contain id 获取日志 | 根据服务器地址和 container id 获取日志 |
| 34781 | 根据 IP 和 pid 查看日志路径 | 根据 IP 和进程 ID 查看日志存储路径 |
| 43318 | 用户画像单个容器日志大于 3G | 检查单个容器日志是否超过 3G |

### 查询定位类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 5659 | 查询使用某个 tube 消费组的所有 oceanus 应用 ID | 根据 TubeMQ 消费组查找关联的应用 |
| 5684 | [oceanus2] 查询使用某个 tube 消费组的所有 oceanus 应用 ID | Oceanus2 版本，根据消费组查找应用 |
| 42558 | [oceanus2 新加坡] 查询使用某个 tube 消费组的所有 oceanus 应用 ID | 新加坡环境，根据消费组查找应用 |
| 15381 | 根据 application_id 查找负责人 | 根据 YARN application id 查找任务负责人 |
| 36264 | 根据机器并集查找任务负责人 | 根据多台机器的并集查找任务负责人 |
| 46802 | 根据多台机器查找交集任务 | 查找同时运行在多台机器上的任务 |
| 39845 | 根据网络连接获取 oc 任务 | 根据网络连接信息定位 Oceanus 任务 |
| 41439 | 根据 IP 和端口查看 application | 根据 IP 和端口查找对应的 application |
| 23776 | oceanus 峰峦机器进程与容器 ID 关系 | 查看峰峦机器上进程与容器 ID 的对应关系 |

### 数据与元数据类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 8694 | Oceanus1 库表迁移工具 | Oceanus1 库表迁移 |
| 11982 | Oceanus1 库表迁移回滚工具 | Oceanus1 库表迁移回滚 |
| 9318 | oceanus1 任务添加负责人 | 为 Oceanus1 任务添加负责人 |
| 17242 | oceanus 交接数据表和应用 | 交接数据表和应用的归属 |
| 27069 | oceanus 解析 metadata 重置 tube offset | 解析 metadata 文件重置 TubeMQ offset |
| 18207 | oceanus1 清理 job_graph | 清理 Oceanus1 任务的 job_graph |
| 24143 | 用户申请 flink 旧版本加白工具 | 用户申请使用 Flink 旧版本的加白操作 |

### 机器与集群运维类

| ID | 工具名称 | 功能介绍 |
|---|---|---|
| 7571 | 清理 oceanus 任务的 shared 文件 | 清理任务产生的 shared 文件 |
| 28726 | oceanus 查看机器 zstd 版本 | 查看机器上 zstd 压缩库版本 |
| 30177 | 修改随机端口范围 | 修改 Flink 节点的随机端口范围 |
| 35578 | 统计 udp 连接数量 | 统计机器上 UDP 连接数 |
| 41509 | oceanus-修改 yarn 磁盘缓存数据目录 | 修改 YARN 磁盘缓存数据目录 |
| 43623 | 扫描 route_cache 大小 | 扫描 route_cache 占用大小 |
| 43626 | flink 节点修复权限错误 | 修复 Flink 节点文件权限错误 |
| 46199 | 机器 ping 耗时 | 检测机器间 ping 延迟 |

## 边界

- [FAIL] 调用 Oceanus REST API
- [FAIL] 修改用户作业 / 平台配置
- [FAIL] 编造知识库未命中的内容

<!-- BIGDATA_QUERY_GUARD -->

## [WARN] --query 参数（强制要求）

每次调用 `do-bigdata` 命令时，**必须**带上 `--query "<用户原始问题>"` 参数，将用户的原始自然语言问题传递给 CLI。

**正确示例**：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util --query "帮我看看 starrocks-prod 最近一小时的 CPU 使用率"
```

**错误示例**（缺少 --query）：
```bash
do-bigdata olap metric-data --cluster starrocks-prod --metric cpu_util
```

> `--query` 参数用于使用回传记录用户的真实问题，缺少此参数会导致回传数据中 `user_query` 字段记录为 CLI 命令而非用户原始问题。

**严禁省略 `--query` 参数。**

<!-- /BIGDATA_QUERY_GUARD -->

<!-- BIGDATA_CLI_GUARD -->

## [WARN] CLI 可用性检查（强制前置）

在执行任何 `do-bigdata` 命令之前，**必须**先检查 CLI 是否已安装：

```bash
which do-bigdata
```

### 如果 CLI 不可用，按以下步骤修复：

**第一步**：执行本地热加载脚本安装 CLI：

```bash
python3 tencent-bigdata/hot_reload.py
```

执行后再次检查 `which do-bigdata`。如果 CLI 已可用，跳到「安装后检查」。

**第二步（仅当第一步后 CLI 仍不可用时）**：本地 `hot_reload.py` 可能是远古版本，不包含 CLI 安装逻辑。需要从远程下载最新版本并重新执行：

```bash
# 从 Skills Manager 下载最新的 hot_reload.py，覆盖本地远古版本
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/hot_reload.py/download" -o tencent-bigdata/hot_reload.py

# 同时更新根 SKILL.md
curl -fsSL "http://bigdata-do-skills-manager.woa.com/api/root-skill/SKILL.md/download" -o tencent-bigdata/SKILL.md

# 执行最新的热加载脚本（会自动安装 CLI + 更新所有 Skills）
python3 tencent-bigdata/hot_reload.py
```

### 安装后检查

检查 hot_reload 输出：
- 如果输出包含 `[WARN] 注意: do-bigdata 不在默认 PATH 中`，需要根据输出的 `bin_dir` 执行 `export PATH` 后再调用 `do-bigdata`
- 如果输出 `CLI 可用: <路径>`，则可直接使用 `do-bigdata` 命令

**如果 CLI 不可用，必须先按照上述步骤完成安装，严禁跳过安装步骤直接放弃调用。** 如果安装出现问题，请联系 shimerhe 处理。

<!-- /BIGDATA_CLI_GUARD -->
