# 获取所有投递意向部门接口 🏢

获取系统中所有可选的投递意向部门列表，用于部门筛选。

## 📋 接口信息

| 项目 | 值 |
|------|-----|
| **路径** | `/zhaopin/campus/campusCenterApi/v1/intentionDepartment/getAllIntentionDepartment` |
| **方法** | `GET` |
| **认证** | ✅ 需要（Cookie认证） |

## 📥 请求参数

无需参数，直接调用即可。

**可选参数**：
- `_t`: 时间戳（用于防缓存，非必需）

## 📤 返回数据

### 成功响应

**HTTP Status**: `200 OK`

```json
{
  "status": 0,
  "message": "",
  "data": [
    {
      "id": 5,
      "name": "TEG技术工程事业群",
      "level": 1,
      "parentId": 0,
      "orderNum": 5,
      "createTime": "2020-01-01T00:00:00",
      "updateTime": "2025-01-01T00:00:00"
    },
    {
      "id": 80,
      "name": "TEG技术工程事业群/AI Lab",
      "level": 2,
      "parentId": 5,
      "orderNum": 1,
      "createTime": "2020-01-01T00:00:00",
      "updateTime": "2025-01-01T00:00:00"
    },
    {
      "id": 81,
      "name": "TEG技术工程事业群/AI平台部",
      "level": 2,
      "parentId": 5,
      "orderNum": 2,
      "createTime": "2020-01-01T00:00:00",
      "updateTime": "2025-01-01T00:00:00"
    }
    // ... 更多部门（通常100+个）
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `number` | 状态码，`0` 表示成功 |
| `message` | `string` | 提示信息 |
| `data` | `array` | 部门列表数组 |
| `data[].id` | `number` | **部门ID**（用于筛选参数） |
| `data[].name` | `string` | 部门全称（格式：事业群/部门） |
| `data[].level` | `number` | 部门层级（1=事业群，2=部门） |
| `data[].parentId` | `number` | 父部门ID（0表示顶级） |
| `data[].orderNum` | `number` | 排序序号 |
| `data[].createTime` | `string` | 创建时间 |
| `data[].updateTime` | `string` | 更新时间 |

### 失败响应

```json
{
  "status": -1,
  "message": "获取部门列表失败",
  "data": null
}
```

## 💡 使用示例

### 示例1：在浏览器 Console 中调用

```bash
# 此接口已改为读取本地数据文件
cat data/intention-departments.json
```

### 示例2：使用 cURL

```bash
curl -X GET \
  'https://zhaopin.woa.com/zhaopin/campus/campusCenterApi/v1/intentionDepartment/getAllIntentionDepartment' \
  -H 'Cookie: your_session_cookie' \
  -H 'x-requested-with: XMLHttpRequest'
```

### 示例3：在 Python 中调用

```python
import requests

url = "https://zhaopin.woa.com/zhaopin/campus/campusCenterApi/v1/intentionDepartment/getAllIntentionDepartment"
headers = {
    "x-requested-with": "XMLHttpRequest"
}
cookies = {
    "session_cookie_name": "your_session_value"
}

response = requests.get(url, headers=headers, cookies=cookies)
data = response.json()

print(f"部门总数: {len(data['data'])}")
for dept in data['data']:
    print(f"{dept['id']:4d} - {dept['name']}")
```

### 示例4：筛选特定层级的部门

```javascript
// 只获取事业群（level=1）
const groups = data.data.filter(d => d.level === 1);

// 只获取具体部门（level=2）
const depts = data.data.filter(d => d.level === 2);

// 获取某个事业群下的所有部门
const tegDepts = data.data.filter(d => d.parentId === 5); // TEG的部门
```

### 示例5：查找特定部门的ID

```bash
# 此接口已改为读取本地数据文件
cat data/intention-departments.json
```

## 🔗 相关接口

- [`search-campus-resume`](./search-campus-resume.md) - 使用部门ID进行简历搜索
- [`get-filter-dictionary`](./get-filter-dictionary.md) - 获取其他筛选条件的字典数据

## ⚠️ 注意事项

1. **认证要求**：必须已登录招聘系统，携带有效的 Cookie
2. **数据结构**：部门名称格式为 `事业群/部门`，便于直接展示
3. **层级关系**：
   - `level=1`: 事业群（如 "TEG技术工程事业群"）
   - `level=2`: 具体部门（如 "TEG技术工程事业群/AI Lab"）
4. **筛选使用**：在简历搜索时，使用 `id` 字段作为 `idepts` 参数的值
5. **数据变动**：部门列表可能随组织架构调整而变化，建议定期更新缓存
6. **性能考虑**：部门列表通常有100+条数据，建议前端做缓存处理

## 🤔 常见问题

**Q: 返回的部门列表有多少个？**

A: 通常有100-200个部门，覆盖腾讯各大事业群（IEG、TEG、PCG、WXG等）。

**Q: 部门ID是固定的吗？**

A: 基本固定，但随着组织架构调整可能会有新增或变更，建议定期同步。

**Q: 如何快速找到某个部门的ID？**

A: 使用 `Array.find()` 或 `filter()` 方法搜索 `name` 字段。

**Q: 可以只获取特定事业群的部门吗？**

A: 该接口返回所有部门，需要在前端通过 `parentId` 或 `name` 字段进行过滤。

## 📖 相关文档

- [投递意向部门筛选条件](../filters/intention-departments.md) - 如何使用部门ID进行筛选
- [当前锁定部门筛选条件](../filters/lock-departments.md) - 锁定部门相关筛选
- [简历筛选手册](../guides/resume-filtering-manual.md) - 返回筛选导航
