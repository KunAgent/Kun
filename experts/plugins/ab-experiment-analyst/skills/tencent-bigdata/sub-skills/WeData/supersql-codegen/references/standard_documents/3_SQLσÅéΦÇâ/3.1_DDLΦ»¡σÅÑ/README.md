# 3.1 DDL语句

DDL（Data Definition Language，数据定义语言）用于定义和管理数据库对象的结构，如数据库、表、视图、索引等。

## 目录结构

- [3.1.1 表名说明](./3.1.1_表名说明.md)
- [3.1.2 创建和删除表](./3.1.2_创建和删除表.md)
- [3.1.3 修改和查看表](./3.1.3_修改和查看表.md)
- [3.1.4 分区操作](./3.1.4_分区操作.md)
- [3.1.5 列操作](./3.1.5_列操作.md)
- [3.1.6 视图操作](./3.1.6_视图操作.md)

## 内容概览

### 3.1.1 表名说明
- db::tablename、tablename/tbl/table说明
- 数据库和表的命名规范

### 3.1.2 创建和删除表
- CREATE TABLE - 创建表
- DROP TABLE - 删除表
- TRUNCATE TABLE - 清空表
- 数据类型说明
- 分区定义
- 存储格式

### 3.1.3 修改和查看表
- ALTER TABLE RENAME - 表重命名
- ALTER TABLE SET/UNSET TBLPROPERTIES - 修改表属性
- SHOW TABLES - 查看表列表
- DESCRIBE/DESC - 查看表结构
- SHOW CREATE TABLE - 查看建表语句

### 3.1.4 分区操作
- ALTER TABLE ADD PARTITION - 增加分区
- INSERT添加分区与动态分区
- ALTER TABLE DROP PARTITION - 删除分区
- TRUNCATE TABLE PARTITION - 清空分区
- SHOW PARTITIONS - 查看分区信息
- 两级分区支持

### 3.1.5 列操作
- ALTER TABLE ADD COLUMNS - 增加字段
- ALTER TABLE REPLACE COLUMNS - 替换字段
- ALTER TABLE CHANGE COLUMN - 修改字段
- 字段操作的限制说明

### 3.1.6 视图操作
- CREATE VIEW - 创建视图
- ALTER VIEW - 更新视图
- DROP VIEW - 删除视图
- SHOW VIEWS - 查看视图

## 快速参考

### 数据库操作
```sql
CREATE DATABASE dbname;           -- 创建数据库
USE dbname;                        -- 切换数据库
SHOW DATABASES;                    -- 查看所有数据库
DROP DATABASE dbname;              -- 删除数据库
```

### 表操作
```sql
CREATE TABLE tablename (...);      -- 创建表
DROP TABLE tablename;              -- 删除表
TRUNCATE TABLE tablename;          -- 清空表
ALTER TABLE old RENAME TO new;     -- 重命名表
SHOW TABLES;                       -- 查看所有表
DESC tablename;                    -- 查看表结构
```

### 分区操作
```sql
ALTER TABLE t ADD PARTITION (...); -- 添加分区
ALTER TABLE t DROP PARTITION (...);-- 删除分区
TRUNCATE TABLE t PARTITION (...);  -- 清空分区
SHOW PARTITIONS tablename;         -- 查看分区
```

### 列操作
```sql
ALTER TABLE t ADD COLUMNS (...);   -- 添加列
ALTER TABLE t CHANGE col ...;      -- 修改列
ALTER TABLE t REPLACE COLUMNS (...);-- 替换列
```

### 视图操作
```sql
CREATE VIEW v AS SELECT ...;       -- 创建视图
DROP VIEW v;                       -- 删除视图
SHOW VIEWS;                        -- 查看视图
```

## 相关章节

- [3.2 DML语句](../3.2_DML语句/) - 数据操作语言
- [3.3 数据类型](../3.3_数据类型/) - TDW支持的数据类型详解
- [3.4 运算符](../3.4_运算符/) - SQL运算符详解
- [4.0 函数参考](../../4_函数参考/) - TDW函数大全

## 注意事项

1. **表名和字段名命名规范**
   - 使用小写字母和下划线
   - 避免使用SQL关键字
   - 使用 `db::tablename` 格式指定数据库

2. **分区表操作**
   - 分区字段不能修改
   - 删除分区会删除数据
   - 支持两级分区

3. **字段操作限制**
   - 不能删除字段
   - 修改字段类型有限制
   - 新增字段默认值为NULL

4. **视图的限制**
   - 视图不支持物化
   - 视图不能创建索引
   - 视图定义不能包含ORDER BY

## 版本说明

本文档基于 TDW SQL 标准语法编写，内容来源于官方SQL在线手册。

---

**最后更新**: 2026-02-03
