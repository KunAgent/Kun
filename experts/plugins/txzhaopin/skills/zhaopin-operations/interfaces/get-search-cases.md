# 获取搜索方案 - 获取用户保存的简历搜索方案列表

获取当前用户保存的搜索方案列表。搜索方案是用户保存的筛选条件组合，便于快速切换不同的筛选场景。

## 接口信息

| 项目 | 值 |
|------|-----|
| URL | `/resume/campus/api/v1/searchCase/getSearchCases` |
| Method | GET |
| Content-Type | application/json |

## 输入参数

| 参数 | 类型 | 必填 | 来源 | 说明 |
|------|------|------|------|------|
| `_t` | number | ❌ | 时间戳 | 防止缓存的时间戳参数 |

## 输出结果

### 成功响应（有保存的方案）

```json
{
  "message": "",
  "status": 0,
  "data": [
    {
      "id": 123,
      "name": "985高校-计算机专业",
      "filters": {
        "school": ["985"],
        "specialityList": ["计算机科学与技术"]
      },
      "createTime": "2027-01-15"
    }
  ]
}
```

### 成功响应（无保存的方案）

```json
{
  "message": "",
  "status": 0,
  "data": null
}
```

| 字段 | 说明 |
|------|------|
| `status` | 状态码，0表示成功 |
| `data` | 搜索方案列表，null表示无保存的方案 |
| `data[].id` | 方案ID |
| `data[].name` | 方案名称 |
| `data[].filters` | 保存的筛选条件 |

## 浏览器调用示例

```bash
# 此接口已改为读取本地数据文件
cat data/search-cases.json
```

## 参考调用示例（暂无 MCP 对应接口）

```bash
# 此接口已改为读取本地数据文件
cat data/search-cases.json
```

## 注意事项

- 搜索方案需要用户在页面上手动保存才会有数据
- 如果返回 `data: null`，说明用户尚未保存任何搜索方案
- 搜索方案通常包含学校、专业、流程状态等多个筛选维度
- 方案列表按创建时间倒序排列
