# 数据源连接器参考手册

## 概述

本文档定义了智数分析引擎支持的所有数据源类型及其连接配置规范。

---

## 关系型数据库

### MySQL / MariaDB

```yaml
connector: mysql
config:
  host: "{hostname}"
  port: 3306
  database: "{db_name}"
  user: "{username}"
  password: "{password}"
  charset: "utf8mb4"
  ssl: false
features:
  - 全功能SQL支持
  - 存储过程和函数
  - 视图查询
  - 事务支持
  - 全文索引
```

### PostgreSQL

```yaml
connector: postgresql
config:
  host: "{hostname}"
  port: 5432
  database: "{db_name}"
  user: "{username}"
  password: "{password}"
  schema: "public"
  sslmode: "prefer"
features:
  - CTE（WITH子句）
  - 窗口函数
  - JSON/JSONB操作
  - 数组类型
  - 全文搜索
  - 地理空间查询（PostGIS）
```

### SQLite

```yaml
connector: sqlite
config:
  file_path: "{path/to/database.db}"
features:
  - 零配置，文件即数据库
  - 基本SQL支持
  - 窗口函数（3.25+）
  - JSON函数（3.38+）
  - 轻量级，适合本地分析
```

### SQL Server

```yaml
connector: mssql
config:
  host: "{hostname}"
  port: 1433
  database: "{db_name}"
  user: "{username}"
  password: "{password}"
  driver: "ODBC Driver 17 for SQL Server"
features:
  - T-SQL完整支持
  - CTE和递归查询
  - 窗口函数
  - PIVOT/UNPIVOT
  - 临时表
```

### Oracle

```yaml
connector: oracle
config:
  host: "{hostname}"
  port: 1521
  service_name: "{service_name}"
  user: "{username}"
  password: "{password}"
features:
  - PL/SQL支持
  - 层次查询（CONNECT BY）
  - 物化视图
  - 分区表
  - 高级分析函数
```

---

## OLAP数据库

### ClickHouse

```yaml
connector: clickhouse
config:
  host: "{hostname}"
  port: 8123          # HTTP接口
  native_port: 9000   # Native接口
  database: "{db_name}"
  user: "{username}"
  password: "{password}"
features:
  - 列式存储，大数据高性能
  - 近实时数据写入
  - 向量化查询引擎
  - 近似计算函数
  - 数据压缩
```

### DuckDB

```yaml
connector: duckdb
config:
  file_path: "{path/to/database.duckdb}"  # 或 :memory:
features:
  - 嵌入式OLAP引擎
  - 直接查询CSV/Parquet文件
  - 列式存储
  - 向量化执行
  - 与pandas无缝集成
```

---

## 文件数据源

### CSV文件

```yaml
connector: csv
config:
  file_path: "{path/to/file.csv}"
  encoding: "utf-8"       # 或 gbk, latin-1
  delimiter: ","           # 分隔符
  header: true             # 是否有表头
  skip_rows: 0             # 跳过行数
processing:
  - 自动类型推断
  - 编码检测
  - 分隔符检测
  - 大文件分块读取
```

### Excel文件

```yaml
connector: excel
config:
  file_path: "{path/to/file.xlsx}"
  sheet_name: null         # null=读取所有sheet
  header_row: 0            # 表头行号
  skip_rows: 0
processing:
  - 多Sheet支持
  - 合并单元格处理
  - 公式结果读取
  - 日期格式解析
```

### JSON/JSONL文件

```yaml
connector: json
config:
  file_path: "{path/to/file.json}"
  format: "json"           # 或 jsonl（按行JSON）
  encoding: "utf-8"
processing:
  - 嵌套结构展平
  - 数组展开
  - Schema推断
```

### Parquet文件

```yaml
connector: parquet
config:
  file_path: "{path/to/file.parquet}"
features:
  - 列式存储高效读取
  - Schema自带
  - 压缩支持
  - 适合大数据文件
```

---

## 向量存储（知识库后端）

### ChromaDB

```yaml
connector: chromadb
config:
  persist_directory: "{path/to/chroma}"
  collection_name: "{collection}"
features:
  - 轻量级本地向量库
  - 简单易用
  - 支持元数据过滤
  - 适合中小规模知识库
```

### Milvus

```yaml
connector: milvus
config:
  host: "{hostname}"
  port: 19530
  collection_name: "{collection}"
  index_type: "IVF_FLAT"
features:
  - 高性能向量搜索
  - 支持十亿级向量
  - 多种索引类型
  - 标量+向量混合搜索
```

### FAISS

```yaml
connector: faiss
config:
  index_path: "{path/to/index}"
  index_type: "Flat"       # 或 IVF, HNSW
features:
  - Facebook研发
  - 极致性能
  - GPU加速
  - 适合大规模相似搜索
```

---

## 连接安全规范

### 凭证管理

| 规则 | 说明 |
|------|------|
| 不记录密码 | 连接密码不出现在日志或分析输出中 |
| 环境变量 | 推荐通过环境变量传递敏感信息 |
| 最小权限 | 数据库用户仅授予SELECT权限 |
| 连接加密 | 生产环境强制SSL/TLS连接 |
| 超时断开 | 空闲连接自动释放 |

### 连接测试流程

```
1. 解析连接参数
2. 建立TCP连接
3. 认证验证
4. 执行 SELECT 1 验证
5. 获取数据库版本和Schema
6. 确认就绪
```

---

## 性能优化建议

### 大数据集处理

| 数据量 | 建议策略 |
|--------|---------|
| < 10万行 | 全量加载到内存 |
| 10万~100万行 | 分批处理或采样分析 |
| 100万~1000万行 | 数据库端聚合，仅拉取结果 |
| > 1000万行 | OLAP引擎 + 物化视图 |

### 查询优化

- 避免 SELECT *，只选需要的字段
- 大结果集添加 LIMIT
- 利用索引进行过滤
- 聚合计算尽量在数据库端完成
- 避免跨库JOIN，改用应用层合并
