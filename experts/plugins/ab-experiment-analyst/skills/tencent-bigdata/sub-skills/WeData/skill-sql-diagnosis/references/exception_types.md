# SuperSQL 异常类型定义

## 1. 语法异常

SQL 语法错误，包括但不限于：

- SQL 关键字拼写错误
- 语法结构不正确（缺少括号、逗号、分号等）
- 数据类型不匹配（如将字符串与数值进行比较而未转换）
- 函数使用错误（参数数量、参数类型不正确）
- 不支持的 SQL 语法特性（如某引擎不支持的窗口函数）
- 别名使用错误
- JOIN 语法错误
- 子查询语法错误

**识别特征**：通常包含 `CalciteContextException`、`SqlParseException`、`syntax error` 等关键字。

## 2. UDF 异常

用户自定义函数（UDF）相关错误，包括：

- UDF 运行时报错（空指针、数组越界等）
- UDF 参数数量不匹配
- UDF 参数类型不匹配
- UDF 依赖缺失（缺少 JAR 包、依赖类未找到）
- UDF 注册失败
- UDF 版本兼容性问题

**识别特征**：通常包含 `UDF`、`GenericUDF`、`FunctionRegistry`、自定义类名异常等关键字。

## 3. 数据权限异常

因权限不足导致的访问或操作拒绝，包括：

- 无表/库的读取权限
- 无表/库的写入权限
- 无执行特定操作的权限（如 DROP、ALTER）
- 封闭域集群访问限制
- 数据分级权限不足

**识别特征**：通常包含 `Permission denied`、`Access denied`、`Unauthorized`、`权限` 等关键字。

**特殊处理**：
- 除"封闭域集群"问题外，解决方案固定为引导用户前往权限申请页面
- 封闭域集群问题需要额外说明

## 4. 系统环境异常

连接失败、超时、版本不兼容、网络抖动等环境层面的问题，包括：

- 数据库连接失败/超时
- 网络抖动导致的连接中断
- 组件版本不兼容
- 资源不足（内存溢出 OOM、磁盘空间不足）
- GAIA/Yarn 资源调度失败
- Livy Session 创建/连接失败
- 服务端内部错误（500 等）
- 北极星名字服务解析失败

**识别特征**：通常包含 `ConnectionException`、`TimeoutException`、`OOM`、`OutOfMemoryError`、`Resource`、`network` 等关键字。

## 5. 数据源读取异常

上游数据源不可用、格式错误、完整性缺失等，包括：

- 数据源连接不可用
- 数据格式错误（如 Parquet/ORC 文件损坏）
- 数据完整性缺失（缺少必要字段）
- 数据文件不存在或已被移动
- 数据源配置错误
- HDFS 文件读取失败

**识别特征**：通常包含 `FileNotFoundException`、`IOException`、`CorruptedData`、`DataSource`、`HDFS` 等关键字。

## 6. 数据表结构异常

找不到库/表/列、分区冲突、Schema 不一致等，包括：

- 表/库/列不存在
- 分区不存在或分区冲突
- Schema 变更导致不一致
- 表已被删除或重命名
- 列类型与预期不匹配
- 元数据信息与实际数据不一致

**识别特征**：通常包含 `TableNotFoundException`、`ColumnNotFoundException`、`SchemaException`、`partition`、`Object not found` 等关键字。

