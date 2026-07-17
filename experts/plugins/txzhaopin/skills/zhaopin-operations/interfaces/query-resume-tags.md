# 查询简历标签 - 批量查询指定类型的标签列表

批量查询指定类型的简历标签列表，支持同时查询多个标签类型。常用于简历筛选中的学校类型、竞赛经历等标签选择。

## 接口信息

| 项目 | 值 |
|------|-----|
| URL | `/resume/campus/api/v1/resume/tag/queryTags` |
| Method | POST |
| Content-Type | application/json |

## 输入参数

### Body 参数（JSON数组）

```json
[
  "label_campus_resume_SchoolType",
  "label_campus_resume_Competition"
]
```

| 参数 | 类型 | 必填 | 来源 | 说明 |
|------|------|------|------|------|
| `[标签类型数组]` | string[] | ✅ | 固定值 | 标签类型代码数组 |

### 常用标签类型

| 标签类型代码 | 说明 | 示例值 |
|-------------|------|--------|
| `label_campus_resume_SchoolType` | 学校类型标签 | 985、211、C9、T28、海外QS100 |
| `label_campus_resume_Competition` | 竞赛标签 | ICPC、ACM、挑战杯、蓝桥杯 |

## 输出结果

```json
{
  "code": 0,
  "success": null,
  "msg": null,
  "data": {
    "label_campus_resume_Competition": [
      {
        "labelValueCode": "ICPC国际大学生程序设计竞赛",
        "labelValueName": "ICPC国际大学生程序设计竞赛"
      },
      {
        "labelValueCode": "KAGGLE",
        "labelValueName": "KAGGLE"
      },
      {
        "labelValueCode": "挑战杯",
        "labelValueName": "挑战杯"
      }
    ],
    "label_campus_resume_SchoolType": [
      {
        "labelValueCode": "211",
        "labelValueName": "211"
      },
      {
        "labelValueCode": "985",
        "labelValueName": "985"
      },
      {
        "labelValueCode": "C9",
        "labelValueName": "C9"
      },
      {
        "labelValueCode": "海外 QS100 高校",
        "labelValueName": "海外 QS100 高校"
      }
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| `code` | 状态码，0表示成功 |
| `data` | 标签数据对象，key为标签类型，value为标签列表 |
| `data.{标签类型}[]` | 该类型的标签列表 |
| `labelValueCode` | 标签代码（用于筛选参数） |
| `labelValueName` | 标签显示名称 |

### 学校类型标签完整列表

- `985` - 985高校
- `211` - 211高校
- `C9` - C9联盟（清北复交等9所）
- `T28` - T28高校
- `T60` - T60高校
- `国内普通高校`
- `大陆普通专科`
- `大陆普通本科`
- `海外 QS100 高校`
- `海外高校`
- `港澳台院校`

### 竞赛标签完整列表（共32种）

包括但不限于：
- `ICPC国际大学生程序设计竞赛`
- `中国大学生程序设计竞赛（ACMCCPC）`
- `全国青少年信息学奥林匹克竞赛（NOI）`
- `KAGGLE`
- `KDDCUP`
- `挑战杯`
- `蓝桥杯大赛`
- `全国大学生数学建模竞赛`
- `全国大学生电子设计竞赛`
- `全国大学生机器人大赛-RoboMaster`
- 等等（详见接口返回的完整列表）

## MCP 调用

```bash
# 简历标签
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_tag_queryTags'
```

## MCP 调用

```bash
# 简历标签
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_tag_queryTags'
```

## 注意事项

- 支持同时查询多个标签类型，只需在数组中添加对应的标签类型代码
- `labelValueCode` 是用于筛选参数的值，`labelValueName` 是显示给用户的名称
- 学校类型标签共11种，竞赛标签共32种
- 标签列表是系统预设的固定值，不会因用户而异
- 在简历搜索接口中使用 `labelValueCode` 作为筛选条件值
