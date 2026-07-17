# 规则管理工具

规则是数据质量监控的核心概念，共 10 个工具（7 个只读 + 3 个写入）。

## 只读工具

### list_rules

查询空间下的规则列表。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| workbench_id | int | 是 | - | 空间ID |
| keyword | str | 否 | "" | 搜索关键词，匹配规则描述 |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页条数 |

**使用场景**：用户问"有哪些规则"、"这个空间下有什么规则"

---

### list_user_rules

查询用户负责的所有规则列表。不传 owner 则自动使用当前认证用户。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| owner | str | 否 | "" | 负责人RTX，不传则使用当前认证用户 |
| keyword | str | 否 | "" | 搜索关键词，支持库表名模糊匹配 |
| page_no | int | 否 | 1 | 页码 |
| page_size | int | 否 | 20 | 每页条数 |

**使用场景**：用户问"我有哪些规则"、"xx用户负责的规则"

> [TIP] 此接口无需空间权限，可查询当前用户负责的所有空间的规则。

---

### get_rule_detail

查询单条规则的完整详情，包括规则配置（阈值、调度、对比方式）、告警配置、最近运行结果和历史趋势。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| item_id | int | 是 | 规则ID |

**使用场景**：用户问"这条规则的具体配置是什么"、"规则xx的阈值多少"

---

### get_baseline_problem_route

查询基线的关键运行链路信息。基线ID就是规则ID（ruleType=baseline 的规则的 itemId）。

**参数**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| baseline_id | int | 是 | - | 基线ID（即规则ID） |
| instance_time | str | 是 | - | 实例时间，格式：yyyyMMdd，如 20260407 |
| promise_task_id | str | 否 | "" | 保障节点ID |
| top_path_no | int | 否 | 1 | 返回的关键链路条数 |

**使用场景**：用户问"这条基线的关键链路是什么"、"基线xx今天的问题链路"、"哪些任务导致基线延迟"

---

## 写入工具

> [WARN] 所有写入操作执行前必须先展示配置预览/变更对比，用户确认后再调用。

### create_rule

创建一条新的监控规则。创建后规则默认开启状态。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workbench_id | int | 是 | 空间ID |
| rule_config | str | 是 | 规则配置的 JSON 字符串 |

**rule_config 通用字段说明**：

所有 ruleCode 共享以下公共字段：

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| workbenchId | 是 | - | 工作台ID |
| monitorName | 是 | - | 监控名称，最大200字符 |
| monitorType | 是 | - | TABLE（离线表）/ TASK（离线任务） |
| dataSource | TABLE必填 | - | 数据源配置（见下方） |
| ruleCode | 是 | - | 规则类型（见各模板） |
| jobs | TASK必填* | - | 作业ID列表，最多50个。如果提供了jobs但未提供jobPlatform或period，系统自动从任务元数据查询 |
| jobPlatform | 否 | 自动查询 | 作业平台：us / venus。**MYSQL/CLICKHOUSE/STARROCKS 数据源必须指定** |
| monitorOwner | 否 | 当前用户 | 监控负责人RTX |
| monitorDesc | 否 | - | 监控描述，最大500字符 |
| period | 否 | DAY | 监控周期：DAY / HOUR / WEEK / MONTH。不提供则从任务元数据查询 |
| status | 否 | ON | ON / OFF |
| ruleType | 否 | "0" | "0"-弱规则 / "1"-强规则 |
| monitorLevel | 否 | B | S / A / B |
| ruleDesc | 否 | - | 规则描述/告警说明 |
| timelinessAlarm | 否 | - | 及时性/基线告警配置 |
| sqlDataSet | 否* | - | 准确性规则配置数组。非一致性规则1个，一致性规则2个 |
| accuracyAlarm | 否 | - | 准确性告警配置 |
| schedulingConfig | 否* | - | 调度配置，准确性规则创建时必填 |
| advancedAlarm | 否 | - | 高级告警条件 |
| alarmReceiverType | 否 | "0" | "0"-指定人 / "1"-值班表 |
| dutyId | 否* | - | 值班表ID，alarmReceiverType为1时必填 |
| alarmPushes | 否 | 默认rtx+当前用户 | 告警推送配置列表 |

**dataSource 结构（TABLE 类型）**：

| 字段 | 必填 | 说明 |
|------|------|------|
| sourceType | 是 | 数据源类型：THIVE / HIVE / **MYSQL / CLICKHOUSE / STARROCKS** |
| database | 是 | 库名 |
| tableName | 是 | 表名 |
| cluster | THIVE/HIVE必填 | 集群名 |
| hostAddr | MYSQL/CLICKHOUSE/STARROCKS必填 | 数据库连接地址，格式 `host:port`，如 `"datafactorytest.mdb.mig:20882"` |
| username | MYSQL/CLICKHOUSE/STARROCKS必填 | 数据库用户名 |
| password | MYSQL/CLICKHOUSE/STARROCKS必填 | 数据库密码 |

> [WARN] **MYSQL/CLICKHOUSE/STARROCKS 类型数据源必须同时指定 `jobPlatform`**，否则会报错。

---

### 子结构详解

#### fields（监测字段）

字段类规则和一致性规则（除 consistency_tblRowCnt）必填。每个字段为对象：

```json
"fields": [
  { "name": "user_id", "type": "string" },
  { "name": "amount",  "type": "bigint" }
]
```

| 属性 | 必填 | 说明 |
|------|------|------|
| name | 是 | 字段名 |
| type | 是 | 字段类型：string / int / bigint / double 等 |

#### partition（分区字段）

可选，用于指定监控分区：

```json
"partition": [
  {
    "name": "imp_date",
    "type": "bigint",
    "format": "yyyyMMdd",
    "rule": "PRODUCTION"
  }
]
```

| 属性 | 必填 | 说明 |
|------|------|------|
| name | 是 | 分区字段名 |
| type | 是 | 分区字段类型 |
| format | 是 | 分区格式，如 yyyyMMdd |
| rule | 是 | 分区规则：PRODUCTION / LATEST_TIME / CUSTOM_TIME |

#### filter（过滤条件）

可选，用于过滤数据：

```json
"filter": [
  { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd" }
]
```

#### schedulingConfig（调度配置）

准确性规则创建时必填：

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| schedulingMethod | 否 | DEPEND | DEPEND（依赖调度）/ TIMER（定时调度） |
| runningResource | 否 | PLATFORM | PLATFORM（平台资源）/ CUSTOM（自定义资源） |
| bgId | CUSTOM必填 | - | BG ID，如 "PCG" |
| productId | CUSTOM必填 | - | 产品ID，如 "6836" |
| tdwAppGroup | CUSTOM必填 | - | TDW应用组，如 "g_pcg_pcgpt900483_pcgolasql" |

> [TIP] 使用 PLATFORM 资源时，bgId/productId/tdwAppGroup 不需要填写，系统自动使用平台默认资源。

#### timelinessAlarm（及时性/基线告警配置）

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| delayPeriod | 否 | 及时性1(T+1)，基线2(T+2) | 延迟周期 |
| slaDay | 否 | - | SLA天数。WEEK周期=周几(1-7，1=星期天)；MONTH周期=当月第几天(1-31)；DAY周期应为null |
| slaHour | 否 | 及时性10，基线0 | SLA小时 |
| slaMinute | 否 | 及时性30，基线0 | SLA分钟 |
| alarmBufferTime | 否 | 30 | 告警余量（分钟），仅基线规则使用 |

#### accuracyAlarm（准确性告警配置）

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| conditions | 是 | - | 告警条件数组，至少1个 |
| boolSymbol | 否 | AND | 多条件的逻辑组合：AND / OR |

**告警条件（AlarmCondition）**：

| 字段 | 必填 | 说明 |
|------|------|------|
| calcType | 是 | 计算方式（见下方限制规则） |
| operation | 是 | 操作符：< / <= / = / != / > / >= / ∈ / ∉ |
| threshold | 是 | 阈值，字符串类型 |
| thresholdType | 是 | 阈值类型：number / string / time |

**calcType 限制规则**（[WARN] 不同规则类型支持的 calcType 不同）：

| 规则类型 | 支持 calcType | 说明 |
|----------|---------------|------|
| field_empty / field_illegal / field_repeat | `proportion_ratio` / `rule_val` | 字段类规则：占比或数量 |
| consistency_* | `diff_ratio` / `diff` | 一致性规则：差异率或差异值 |
| tbl_rowCnt / field_rowCnt / field_rowCntDistinct / field_sum / field_avg / user_custom | `const` / `day_wave_ratio` / `day_wave` / `week_wave_ratio` / `week_wave` | 其他准确性规则：原始值或波动率 |

| calcType | 说明 |
|----------|------|
| rule_val | 规则计算值（数量） |
| proportion_ratio | 占比（空值率/非法值率/重复率） |
| const | 原始值 |
| diff | 差异值 |
| diff_ratio | 差异率 |
| day_wave | 日波动值 |
| day_wave_ratio | 日波动率 |
| week_wave | 周波动值 |
| week_wave_ratio | 周波动率 |

#### advancedAlarm（高级告警条件，可选）

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| silentStartTime | 否 | - | 免打扰起始时间，格式 HH:mm:ss，如 "22:00:00" |
| silentEndTime | 否 | - | 免打扰结束时间，格式 HH:mm:ss，如 "08:00:00" |
| alarmType | 否 | - | 告警类型：0-规则触发告警，1-数据正常通知，可多选 [0,1] |
| alarmStatus | 否 | ON | ON / OFF |
| isMergeNotify | 否 | 0 | 0-不合并 / 1-合并。当 alarmType 含1时，设为1可将同监控下多规则正常通知合并发送 |

#### alarmPushes（告警推送配置，可选）

```json
"alarmPushes": [
  { "pushType": "rtx",    "receiver": ["user1", "user2"] },
  { "pushType": "email",  "receiver": ["user1"] },
  { "pushType": "webhook","receiver": ["https://webhook.example.com"] }
]
```

| pushType | 说明 |
|----------|------|
| rtx | 企业微信 |
| email | 邮件 |
| wx | 微信 |
| rtxg | 企业微信群 |
| phone | 电话 |
| sms | 短信 |
| tk | Ticket工单 |
| webhook | API回调 |

> [TIP] 不提供 alarmPushes 时，系统默认使用企业微信（rtx），接收人为当前用户。

---

### 规则类型配置模板

按 ruleCode 分为四大类，每类提供完整的 JSON 配置模板。

---

#### 一、及时性规则（timeliness）

监控表/任务的数据产出是否及时。必填字段：dataSource、monitorLevel、timelinessAlarm。

**最简参数**：

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表及时性监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di"
  },
  "ruleCode": "timeliness",
  "jobs": ["20250812141521793"]
}
```

**完整参数**：

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表及时性监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "timeliness",
  "monitorOwner": "user001",
  "monitorDesc": "监控用户表数据产出及时性",
  "period": "DAY",
  "status": "ON",
  "ruleType": "0",
  "monitorLevel": "B",
  "ruleDesc": "数据延迟告警",
  "jobs": ["20250812141521793"],
  "jobPlatform": "us",
  "timelinessAlarm": {
    "delayPeriod": "1",
    "slaDay": null,
    "slaHour": 10,
    "slaMinute": 30
  },
  "alarmPushes": [
    { "pushType": "rtx",   "receiver": ["user001", "user002"] },
    { "pushType": "email", "receiver": ["user001", "user002"] }
  ],
  "advancedAlarm": {
    "silentStartTime": "22:00:00",
    "silentEndTime": "08:00:00",
    "alarmType": [0],
    "alarmStatus": "ON",
    "isMergeNotify": 0
  }
}
```

---

#### 二、基线规则（baseline）

监控数据产出是否在承诺时间内完成。必填字段：dataSource、monitorLevel、timelinessAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "数据基线监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "baseline",
  "ruleDesc": "监控数据基线，T+2 00:00前必须完成",
  "status": "ON",
  "ruleType": "0",
  "monitorLevel": "B",
  "period": "DAY",
  "timelinessAlarm": {
    "delayPeriod": "2",
    "slaDay": null,
    "slaHour": 0,
    "slaMinute": 0,
    "alarmBufferTime": "30"
  },
  "jobs": ["20250812112252604"]
}
```

---

#### 三、表行数规则（tbl_rowCnt）

监控表的总行数变化。表级规则无需 fields。必填字段：dataSource、sqlDataSet(1个)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "单条表记录数监控",
  "monitorType": "TABLE",
  "monitorOwner": "your_rtx",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "tbl_rowCnt",
  "ruleDesc": "表记录数规则",
  "status": "ON",
  "ruleType": "0",
  "monitorLevel": "B",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ],
      "filter": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "const", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "advancedAlarm": {
    "alarmStatus": "ON",
    "alarmType": [0],
    "silentStartTime": "22:00:00",
    "silentEndTime": "08:00:00"
  }
}
```

> [TIP] tbl_rowCnt 不需要 fields，calcType 使用 `const`（原始值）、`day_wave_ratio` 等。

---

#### 四、字段空值规则（field_empty）

监控字段空值率。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表字段空值监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_empty",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "user_id", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "proportion_ratio", "operation": ">", "threshold": "0.03", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

> [TIP] field_empty 只支持 calcType: `proportion_ratio`（占比）或 `rule_val`（数量）。

---

#### 五、字段非法值规则（field_illegal）

监控字段非法值率。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表非法值监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_illegal",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "phone", "type": "string" },
        { "name": "email", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "proportion_ratio", "operation": ">", "threshold": "0.01", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

> [TIP] field_illegal 只支持 calcType: `proportion_ratio`（占比）或 `rule_val`（数量）。

---

#### 六、字段重复值规则（field_repeat）

监控字段重复率。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表字段重复值监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_repeat",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "id", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "rule_val", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

> [TIP] field_repeat 只支持 calcType: `proportion_ratio`（占比）或 `rule_val`（数量）。主键重复检查通常阈值设为 "0"。

---

#### 七、字段记录数规则（field_rowCnt）

监控字段的记录数。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表字段记录数监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_rowCnt",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "order_id", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "const", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

> [TIP] field_rowCnt 支持 calcType: `const` / `day_wave_ratio` / `day_wave` / `week_wave_ratio` / `week_wave`。

---

#### 八、字段去重记录数规则（field_rowCntDistinct）

监控字段去重后的记录数。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表去重记录数监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_rowCntDistinct",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "user_id", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "const", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

---

#### 九、字段求和值规则（field_sum）

监控字段求和值的变化。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表求和值监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_sum",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "amount", "type": "bigint" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "const", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

> [TIP] field_sum 要求 fields 为数值型字段，calcType 支持 `const` / `day_wave_ratio` 等。

---

#### 十、字段平均值规则（field_avg）

监控字段平均值的变化。必填字段：dataSource、sqlDataSet(1个，含fields)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表平均值监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_avg",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "price", "type": "double" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "const", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

> [TIP] field_avg 要求 fields 为数值型字段，calcType 支持 `const` / `day_wave_ratio` 等。

---

#### 十一、一致性规则（consistency_*）

一致性规则用于比较源表和目标表的数据是否一致，需要 **2 个 sqlDataSet**。必填字段：dataSource、sqlDataSet(2个)、schedulingConfig、accuracyAlarm。

**一致性规则类型**：

| ruleCode | 说明 | 比较内容 | fields |
|----------|------|----------|--------|
| consistency_tblRowCnt | 数据记录数一致性 | 源表与目标表总行数 | 不需要 |
| consistency_rowCnt | 记录数一致性 | 指定字段的记录数 | 需要 |
| consistency_rowCntDistinct | 去重记录数一致性 | 指定字段去重后的记录数 | 需要 |
| consistency_sum | 求和值一致性 | 指定字段的求和值 | 需要 |
| consistency_avg | 平均值一致性 | 指定字段的平均值 | 需要 |

> [TIP] consistency_* 只支持 calcType: `diff_ratio`（差异率）或 `diff`（差异值）。

**配置模板**（以 consistency_rowCnt 为例，目标表为 THIVE）：

```json
{
  "workbenchId": "1673",
  "monitorName": "测试数据一致性监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "consistency_rowCnt",
  "ruleDesc": "监控数据记录数一致性",
  "status": "ON",
  "ruleType": "0",
  "monitorLevel": "B",
  "period": "DAY",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "id", "type": "bigint" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    },
    {
      "sourceType": "THIVE",
      "databaseName": "pcg_meta",
      "tableName": "dws_dqc_datatalk_table_task_unable_detect_upstream_df",
      "cluster": "同乐",
      "fields": [
        { "name": "imp_date", "type": "bigint" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "diff_ratio", "operation": "<=", "threshold": "0.005", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812112252604"]
}
```

**sqlDataSet 源表 vs 目标表**：

| 位置 | 说明 | 数据源字段 |
|------|------|------------|
| sqlDataSet[0] | 源表（复用 dataSource） | 不需要 sourceType/databaseName/tableName，自动复用 |
| sqlDataSet[1] | 目标表 | 必须指定 sourceType/databaseName/tableName，JDBC类型还需 hostAddr/username/password |

**目标表支持的数据源类型**：THIVE / HIVE / ICEBERG / **MYSQL / CLICKHOUSE / STARROCKS**

**目标表为 ICEBERG 的一致性规则示例**（consistency_tblRowCnt，无需 fields）：

```json
{
  "workbenchId": "1673",
  "monitorName": "一致性监控-ICEBERG目标",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "consistency_tblRowCnt",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    },
    {
      "sourceType": "ICEBERG",
      "databaseName": "sz1_oladm",
      "tableName": "mdb_t_monitor_item",
      "cluster": "同乐"
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "diff_ratio", "operation": "<=", "threshold": "0.08", "thresholdType": "number" }
    ]
  }
}
```

**目标表为 MYSQL 的一致性规则示例**：

```json
{
  "workbenchId": "1673",
  "monitorName": "一致性监控-MYSQL目标表",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "consistency_rowCnt",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "id", "type": "bigint" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    },
    {
      "sourceType": "MYSQL",
      "databaseName": "db_ola_qualityengine",
      "tableName": "t_dqc_monitor",
      "hostAddr": "datafactorytest.mdb.mig:20882",
      "username": "writeuser",
      "password": "your_password",
      "fields": [
        { "name": "id", "type": "bigint" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "diff_ratio", "operation": "<=", "threshold": "0.005", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812112252604"]
}
```

---

#### 十二、自定义SQL规则（user_custom）

使用自定义 SQL 语句进行灵活的质量校验。必填字段：dataSource、sqlDataSet(1个，含customSql)、schedulingConfig、accuracyAlarm。

```json
{
  "workbenchId": "1673",
  "monitorName": "自定义SQL监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "user_custom",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "id", "type": "bigint" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ],
      "customSql": {
        "sqlType": "supersql",
        "sql": "SELECT COUNT(*) as cnt FROM pcg_meta.dws_dqc_user_profile_updata_source_di WHERE imp_date = %yyyyMMdd%"
      }
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "const", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

**customSql 配置**：

| 字段 | 必填 | 说明 |
|------|------|------|
| sqlType | 否 | SQL类型：supersql / presto / impala |
| sql | 是 | 自定义SQL，最大5000字符 |
| setCommands | 否 | SET命令 |

**SQL 内置变量**：
- `%yyyyMMdd%` — 业务日期占位符

> [TIP] user_custom 支持 calcType: `const` / `day_wave_ratio` / `day_wave` / `week_wave_ratio` / `week_wave`。

---

#### 附：使用自定义资源的准确性规则

当平台资源不满足需求时，可使用自定义资源（runningResource 为 CUSTOM）：

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表字段重复值监控（自定义资源）",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_repeat",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "CUSTOM",
    "bgId": "PCG",
    "productId": "6836",
    "tdwAppGroup": "g_pcg_pcgpt900483_pcgolasql"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "id", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "rule_val", "operation": ">", "threshold": "0", "thresholdType": "number" }
    ]
  },
  "jobs": ["20250812141521793"]
}
```

#### 附：MYSQL 数据源的及时性规则

MYSQL/CLICKHOUSE/STARROCKS 类型数据源需要额外提供连接信息，且必须指定 jobPlatform：

```json
{
  "workbenchId": "1673",
  "monitorName": "MYSQL数据及时性监控",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "MYSQL",
    "database": "db_ola_qualityengine",
    "tableName": "t_dqc_monitor",
    "hostAddr": "datafactorytest.mdb.mig:20882",
    "username": "writeuser",
    "password": "your_password"
  },
  "ruleCode": "timeliness",
  "ruleDesc": "监控数据及时性，T+1 10:30前必须完成",
  "status": "ON",
  "ruleType": "0",
  "monitorLevel": "B",
  "period": "DAY",
  "jobPlatform": "us",
  "timelinessAlarm": {
    "delayPeriod": "1",
    "slaDay": null,
    "slaHour": 10,
    "slaMinute": 30
  },
  "jobs": ["20250812112252604"]
}
```

#### 附：使用合并正常通知的规则

当 alarmType 包含 1（数据正常通知）时，设置 isMergeNotify 为 1 可合并同监控下多规则的正常通知：

```json
{
  "workbenchId": "1673",
  "monitorName": "用户表字段空值监控（合并通知）",
  "monitorType": "TABLE",
  "dataSource": {
    "sourceType": "THIVE",
    "database": "pcg_meta",
    "tableName": "dws_dqc_user_profile_updata_source_di",
    "cluster": "同乐"
  },
  "ruleCode": "field_empty",
  "schedulingConfig": {
    "schedulingMethod": "DEPEND",
    "runningResource": "PLATFORM"
  },
  "sqlDataSet": [
    {
      "fields": [
        { "name": "user_id", "type": "string" }
      ],
      "partition": [
        { "name": "imp_date", "type": "bigint", "format": "yyyyMMdd", "rule": "PRODUCTION" }
      ]
    }
  ],
  "accuracyAlarm": {
    "boolSymbol": "AND",
    "conditions": [
      { "calcType": "proportion_ratio", "operation": ">", "threshold": "0.03", "thresholdType": "number" }
    ]
  },
  "advancedAlarm": {
    "alarmType": [0, 1],
    "alarmStatus": "ON",
    "isMergeNotify": 1
  },
  "jobs": ["20250812141521793"]
}
```

---

### modify_rule

修改已有规则的配置。支持部分更新，只需传递需要修改的字段。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workbench_id | int | 是 | 空间ID |
| item_id | int | 是 | 规则ID |
| changes | str | 是 | 需要修改的字段的 JSON 字符串 |

**注意事项**：
- 必须包含 `itemId` 字段（值为 item_id）
- 不可修改字段：ruleCode（规则类型）、monitorType（监控类型）、dataSource（数据源）
- 可修改字段：monitorName、monitorDesc、monitorOwner、ruleDesc、status、ruleType、monitorLevel、period、schedulingConfig、sqlDataSet、accuracyAlarm、timelinessAlarm、alarmReceiverType、dutyId、alarmPushes、advancedAlarm 等
- 修改时只传需要更新的字段，未传字段保持原值

---

### create_monitor_with_rules

批量创建多规则，支持追加到已有监控。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| monitor_config | str | 是 | 监控配置的 JSON 字符串 |

**monitor_config 结构**：

```json
{
  "workbenchId": 10001,
  "monitorName": "表质量监控",
  "monitorType": "表监控",
  "dataSource": {
    "datasourceType": "hive",
    "dbName": "db_name",
    "tableName": "table_name"
  },
  "items": [
    {
      "itemName": "空值率检查",
      "ruleType": "field_empty",
      "ruleSubType": "proportion_ratio",
      "period": "D",
      "datasourceType": "hive"
    }
  ]
}
```

追加模式时传入 `monitorId` 即可。

---

### batch_modify_rules

批量修改监控规则。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| modify_config | str | 是 | 批量修改配置的 JSON 字符串 |

**modify_config 结构**：

```json
{
  "monitorId": 20001,
  "rules": [
    {
      "itemId": 30001,
      "ruleDesc": "更新后的描述"
    }
  ]
}
```

---

### enable_rule / disable_rule

开启/关闭一条规则。关闭不会删除规则配置。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| workbench_id | int | 是 | 空间ID |
| item_id | int | 是 | 规则ID |

**使用场景**：
- enable_rule：用户说"开启这条规则"、"启动xx监控"
- disable_rule：用户说"关闭这条规则"、"暂停xx监控"
