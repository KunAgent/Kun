# 获取技能标签列表 - 技能标签接口

获取校园招聘简历筛选的技能标签候选列表，用于按技能标签筛选候选人。

## 接口信息

- **接口路径**：`/resume/campus/api/v1/dictionary/getTagList`
- **请求方法**：GET
- **接口说明**：获取标签列表，支持多种标签类型（技能、专业等）

## 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tagType` | string | ✅ | 标签类型，`skill`=技能标签 |
| `tagName` | string | ❌ | 标签名称（模糊搜索），空字符串=获取全部 |

## 输出结果

```json
{
  "message": "",
  "status": 0,
  "data": [
    "网络安全",
    "数据安全",
    "ai安全",
    "java",
    "python",
    "c++",
    "tensorflow",
    "pytorch",
    "..."
  ]
}
```

### 关键字段说明

| 字段 | 说明 |
|------|------|
| `data` | 技能标签字符串数组 |

## 技能标签统计

系统共支持**1103个技能标签**，涵盖以下主要类别：

### 安全类（约20+）
- 网络安全、数据安全、安全策略、安全合规
- 静态分析、主机安全、ai安全
- 自动化测试、模糊测试、渗透测试
- 等等...

### 编程语言（约30+）
- go、java、c++、python、sql、lua、rust
- javascript、php、cuda
- 等等...

### AI/机器学习（约50+）
- tensorflow、pytorch、deepsspeed、langchain
- tensorrt、推理引擎、rag
- 机器学习平台、压缩、编码
- 等等...

### 大数据（约40+）
- hadoop、hive、spark、flink
- 流计算、数据挖掘
- 等等...

### 开发工具（约100+）
- git、jmeter、postman、jenkins
- wireshark、elk、filebeat
- 等等...

### 其他技术领域
- 搜索引擎、索引、排序、召回
- hpc（高性能计算）
- 以及更多...

**说明**：完整的1103个技能标签列表较长，建议通过接口动态获取。

**完整列表文件**：[data/skill-tags-full.json](../data/skill-tags-full.json)（包含所有1103个技能标签）

## MCP 调用

### 获取全部技能标签

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' params='{"tagType": "skill"}'
```

### 模糊搜索技能标签

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_dictionary_getTagList' params='{"tagType": "skill", "tagName": "python"}'
```

## 在简历搜索中使用

技能标签使用 `skillList` 参数，值为**技能标签名称的字符串数组**。

### 示例

**单个技能标签**：
```json
{
  "skillList": ["ai安全"]
}
```

**多个技能标签**：
```json
{
  "skillList": ["ai安全", "网络安全", "python"]
}
```

**无筛选**：
```json
{
  "skillList": []
}
```

## 应用场景

1. **技能筛选**：在简历搜索时按技能标签筛选候选人
2. **技能选择器**：构建技能标签选择的UI组件，支持自动补全
3. **技能统计**：分析各技能标签的简历分布
4. **简历推荐**：根据技能标签进行候选人匹配

## 注意事项

**参数特点**：
- 技能标签使用**名称字符串**进行筛选
- `skillList` 参数接收字符串数组
- 标签名称必须完全匹配（区分大小写）

**模糊搜索**：
- `tagName` 参数支持模糊搜索
- 空字符串返回全部1103个标签
- 建议在UI中实现自动补全功能

**接口复用**：
- 该接口支持多种标签类型（通过 `tagType` 参数）
- `skill` = 技能标签
- `submajor` = 专业标签（已在专业查询接口中使用）
- 可能还有其他标签类型

**数据量大**：
- 全量1103个标签一次性返回
- 建议前端缓存，避免重复请求
- 可以通过 `tagName` 参数实现服务端过滤

**筛选逻辑**：
- 空数组 `[]` = 不筛选
- 多个标签之间的关系需要根据业务需求确定（AND/OR）
- 建议按实际需求选择特定技能标签进行筛选
