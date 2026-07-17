# 技术方向筛选条件 🚀

筛选候选人的技术方向（AI大模型/基础架构/大数据等）。

## 📋 参数信息

| 项目 | 值 |
|------|-----|
| **参数名** | `techDirectionsTxt` |
| **类型** | `string[]` （字符串数组） |
| **必填** | ❌ 否（不填或传空数组表示不筛选） |
| **逻辑** | OR（数组内满足任意一个即可） |

## 🎯 获取可选值

### 方式：字典接口（动态）

调用 `get-tech-direction-dict` 接口获取：

```javascript
GET /zhaopin/campus/campusCenterApi/v1/dictionary/getBusinessDictionary?type=TECH_DIRECTION
```

**返回示例**：
```json
{
  "status": 0,
  "data": [
    {"did": "5", "name": "AI大模型"},
    {"did": "9", "name": "基础架构"},
    {"did": "10", "name": "高性能计算"},
    {"did": "6", "name": "大数据"},
    {"did": "7", "name": "多媒体"},
    {"did": "8", "name": "安全"},
    {"did": "11", "name": "游戏引擎"},
    {"did": "12", "name": "机器人"},
    {"did": "13", "name": "量子"},
    {"did": "17", "name": "金融科技"}
  ]
}
```

### 技术方向列表（10个）

| ID | 名称 | 说明 |
|----|------|------|
| 5 | AI大模型 | 人工智能大模型方向 |
| 9 | 基础架构 | 基础技术架构方向 |
| 10 | 高性能计算 | HPC高性能计算方向 |
| 6 | 大数据 | 大数据技术方向 |
| 7 | 多媒体 | 音视频多媒体方向 |
| 8 | 安全 | 信息安全方向 |
| 11 | 游戏引擎 | 游戏引擎技术方向 |
| 12 | 机器人 | 机器人技术方向 |
| 13 | 量子 | 量子计算方向 |
| 17 | 金融科技 | 金融科技方向 |

**使用哪个字段？**  
使用 `name` 字段（技术方向名称），**不是** `did` 字段！

## 💡 使用示例

### 示例1：筛选AI大模型方向

```javascript
{
  techDirectionsTxt: ["AI大模型"]
}
```

### 示例2：筛选AI或大数据方向

```javascript
{
  techDirectionsTxt: ["AI大模型", "大数据"]
}
```

**效果**：筛选技术方向为 AI大模型 **或** 大数据的候选人

### 示例3：筛选技术类方向

```javascript
{
  techDirectionsTxt: ["基础架构", "高性能计算", "游戏引擎"]
}
```

### 示例4：不筛选技术方向

```javascript
{
  techDirectionsTxt: []  // 空数组
}
```

## ⚠️ 注意事项

1. **使用名称**：必须使用 `name` 字段的值（如 `"AI大模型"`），**不是** `did` 字段的值（如 `"5"`）
2. **精确匹配**：技术方向名称必须与接口返回的 `name` 字段**完全一致**
3. **OR 逻辑**：数组内多个方向是 OR 关系（满足任意一个即可）
4. **AND 逻辑**：与其他筛选条件（如学校、专业）是 AND 关系
5. **全选 ≠ 不筛选**：全选10个方向会排除未填技术方向的简历，而空数组 `[]` 则包含所有简历

## 🔗 在搜索接口中使用

```javascript
POST /resume/campus/api/v1/resume/search

{
  page: 1,
  limit: 20,
  searchId: "search-xxx",
  searchStrategy: {"version": "V3", "strategy": "strategy-V3"},
  techDirectionsTxt: ["AI大模型", "基础架构"],  // ⭐ 技术方向参数（使用名称）
  graduate_time_begin: "2027-01-01",
  graduate_time_end: "2027-12-31",
  // ... 其他参数
}
```

## 🤔 常见问题

**Q: 为什么参数名是 techDirectionsTxt 而不是 techDirections？**

A: `Txt` 后缀表示使用文本名称而非ID。系统设计上，技术方向使用名称进行筛选。

**Q: 技术方向和技能标签有什么区别？**

A: 
- **技术方向**（`techDirectionsTxt`）：宏观的技术领域，共10个固定选项
- **技能标签**（`skillList`）：具体的技能点，共1103个标签，更细粒度

**Q: 如果候选人未填写技术方向，会被筛选出来吗？**

A: 取决于你的筛选条件：
- 使用空数组 `[]` → **会**筛选出所有候选人（包括未填的）
- 指定特定方向 → **不会**筛选出未填的候选人

## 📖 相关文档

- [`get-tech-direction-dict`](../interfaces/get-tech-direction-dict.md) - 获取技术方向字典接口
- [技能标签筛选条件](./skill-tags.md) - 更细粒度的技能筛选
