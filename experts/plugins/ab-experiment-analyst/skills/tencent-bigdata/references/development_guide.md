# Skill 开发指南

## 目录结构详解

```
do_skills/
├── SKILL.md              # 根 Skill（路由）
├── hot_reload.py         # 热加载脚本（会话前置，从远程 Skills Manager 拉取最新 sub-skills，并自动检查/安装 do-bigdata CLI）
├── security_file/        # 凭证配置目录（加密 CMK）
│   └── config.enc        # 加密后的 CMK 凭证（user / cmk / cmk_id）
├── references/           # 根级参考文档
│   ├── skill_catalog.md  # 全量 Skill 明细目录
│   ├── operation_guide.md    # 运维操作参考指南
│   └── development_guide.md  # 本文件
└── sub-skills/           # 所有子系统 Skills 存放目录
    ├── Authentication/       # 权限子系统
    │   ├── SKILL.md
    │   └── table-permission-check/
    ├── Flink/                # Flink 子系统
    │   ├── SKILL.md          # 子系统路由描述
    │   ├── common/           # 子系统公共模块
    │   ├── flink-yarn-perjob/
    │   │   ├── SKILL.md      # Skill 定义
    │   │   ├── version       # 本地版本号
    │   │   ├── references/   # 参考文档
    │   │   └── scripts/      # 工具脚本
    │   ├── oceanus-job-list/
    │   ├── oceanus-log-analyzer/
    │   ├── oceanus-resource-advisor/
    │   ├── oceanus-job-management/
    │   ├── oceanus-file-management/
    │   ├── oceanus-metrics-query/
    │   ├── oceanus-project-management/
    │   └── oceanus-resource-management/
    ├── HDFS/                 # HDFS 子系统
    │   ├── SKILL.md
    │   ├── hdfs-miss-block-diagnose/
    │   ├── hdfs-cluster-load-diagnose/
    │   ├── hdfs-storage-full-diagnose/
    │   └── hdfs-basic-operations/
    ├── OLAP/                 # OLAP（StarRocks）子系统
    │   ├── SKILL.md
    │   ├── starrocks-load-analysis/
    │   ├── starrocks-query-failure/
    │   ├── starrocks-query-info/
    │   ├── starrocks-schema-change/
    │   ├── starrocks-cluster-ops/
    │   ├── starrocks-mv-troubleshooting/
    │   ├── starrocks-privilege-analysis/
    │   └── starrocks-data-distribution/
    ├── Spark/                # Spark 子系统
    │   ├── SKILL.md
    │   └── spark-slow-analyzer/
    ├── SuperSQL/             # SuperSQL 子系统
    │   ├── SKILL.md
    │   ├── supersql-job-analyzer/
    │   └── supersql-slow-query-analyzer/
    ├── TDBank/               # TDBank 数据接入子系统（[WARN] 已废弃，保留仅作历史归档，新需求请迁移至 DataIntegration/）
    │   ├── SKILL.md
    │   ├── pulsar-subscription-diagnosis/
    │   ├── tdbank-query-info/
    │   ├── tubemq-cli-log-analyzer/
    │   └── inlong-query-info/
    ├── DataIntegration/       # 数据接入子系统（TDBank 的重构替代，统一命令前缀 `dataintegration <prefix>:*`）
    │   ├── SKILL.md
    │   ├── inlong-platform-diagnosis/     # InLong 平台一站式诊断（命令前缀 `inlong:`）
    │   ├── tdbank-platform-diagnosis/     # TDBank 平台一站式诊断（命令前缀 `tdbank:`）
    │   ├── tubemq-diagnosis/              # TubeMQ 日志分析 + 消费组指标诊断（命令前缀 `tubemq:`）
    │   └── pulsar-diagnosis/              # Pulsar 订阅滞后诊断（命令前缀 `pulsar:`）
    ├── US/                   # US（统一调度）子系统
    │   ├── SKILL.md
    │   ├── us-log-analyzer/
    │   ├── us-fail-task-diagnose/
    │   └── us-slow-task-diagnose/
    ├── WeData/               # WeData 子系统
    │   ├── SKILL.md
    │   ├── sql-execute-analyze/
    │   ├── chatbi/
    │   ├── supersql-codegen/
    │   └── sql-prediagnosis/
    └── Yarn/                 # Yarn 子系统
        ├── SKILL.md
        ├── yarn-app-diagnose/
        └── yarn-queue-analysis/
```

## 如何新增 Skill

1. 在对应子系统目录（如 `Flink/`、`US/`）下创建新的子目录，目录名即为 Skill 名称
   - 命名规范：小写字母 + 连字符（如 `hdfs-miss-block-diagnose`）
- **禁止**使用下划线（如 ~~sql_prediagnosis~~）
2. 如果是新子系统，先在 `sub-skills/` 下创建子系统目录，并在其中创建 `SKILL.md` 定义子系统路由
3. 在 Skill 子目录中创建以下文件：

| 文件/目录 | 必需 | 说明 |
|-----------|------|------|
| `SKILL.md` | **是** | Skill 定义，必须包含 `name` 和 `description` 的 YAML frontmatter |
| `version` | **是** | 版本号文件 |
| `scripts/` | 推荐 | 可执行工具脚本（Python） |
| `references/` | 推荐 | 参考文档（Markdown） |

4. SKILL.md 推荐章节结构：

```markdown
---
name: <skill-name>
description: >
  <一句话触发描述，50-200 字符>
---

# <Skill 标题>

## 概述
## 触发条件（触发场景 + 不触发场景）
## 前置条件
## 工作流
## 资源
```

5. 在 Skills Manager 中注册并打包发布，热加载机制会自动分发到使用端

## 子 Skill SKILL.md 编写规范

### frontmatter

- `name`（必填）：Skill 名称，与目录名一致
- `description`（必填）：50-200 字符，具体描述触发场景和核心功能

### 内容规范

- 使用**指令式**写法（"执行 xxx"而非"你应该 xxx"）
- 避免说教性内容（"需要强调的是..."），直接给出指令
- 单文件不超过 500 行，超出部分迁移到 `references/`
- 包含明确的**触发场景**和**不触发场景**
- 提供完整的命令行示例（含参数）
- 定义完成标准和错误处理指引

## Python 脚本规范

- 兼容 Python 3.7+（避免 `X | Y` 联合类型、`match/case` 语法）
- 使用 `argparse` 进行参数校验，参数需有 `required` 和 `help` 说明
- 使用 `try-except` 进行错误处理
- 使用 `json.dumps` 输出结构化结果
- 凭证通过 `do-bigdata` CLI（`@auth_required` 装饰器）自动注入，**严禁读取明文 CMK 文件**，**严禁硬编码**
