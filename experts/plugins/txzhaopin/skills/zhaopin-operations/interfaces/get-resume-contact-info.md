# 获取简历联系方式接口 📞

获取候选人的完整联系方式（手机号、邮箱、微信等）。

⚠️ **敏感信息接口**：本接口返回候选人的真实联系方式，需要相应权限。

## 📋 接口信息

| 项目 | 值 |
|------|-----|
| **路径** | `/resume/campus/api/v1/resume/getResumeContactInfo` |
| **方法** | `GET` |
| **认证** | ✅ 需要（Cookie认证 + 查看联系方式权限） |

## 📥 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `resumeId` | `number` | ✅ | 简历数字ID |

**示例**:
```
GET /resume/campus/api/v1/resume/getResumeContactInfo?resumeId=3547501
```

## 📤 返回数据

### 成功响应

**HTTP Status**: `200 OK`

```json
{
  "msg": "success",
  "code": 200,
  "data": {
    "resumeId": 3547501,
    "name": "张三",
    "mobile": "13812345678",
    "email": "zhangsan@example.com",
    "wechat": "zhangsan_wx",
    "qq": "123456789",
    "phone": "0755-12345678",
    "emergencyContact": "张女士",
    "emergencyMobile": "13987654321",
    "emergencyRelation": "母亲"
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `resumeId` | `number` | 简历ID |
| `name` | `string` | 候选人姓名 |
| `mobile` | `string` | **手机号（完整）** |
| `email` | `string` | **邮箱（完整）** |
| `wechat` | `string` | 微信号 |
| `qq` | `string` | QQ号 |
| `phone` | `string` | 座机号码 |
| `emergencyContact` | `string` | 紧急联系人姓名 |
| `emergencyMobile` | `string` | 紧急联系人电话 |
| `emergencyRelation` | `string` | 紧急联系人关系 |

### 失败响应

**无权限**:
```json
{
  "msg": "无权查看联系方式",
  "code": 403,
  "data": null
}
```

**简历不存在**:
```json
{
  "msg": "简历不存在",
  "code": 404,
  "data": null
}
```

## 💡 使用示例

### 示例1：获取单个简历的联系方式

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_getResumeContactInfo' params='{"resumeId": "${resumeId}"}'
```

### 示例2：先获取基本信息，再获取联系方式

```bash
# 简历基本信息
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.get_v1_mcp_resume_getResumeByRId'

# 联系方式
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_getResumeContactInfo'
```

### 示例3：批量获取联系方式（带权限检查）

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_getResumeContactInfo' params='{"resumeId": "${resumeId}"}'
```

### 示例4：导出联系方式到CSV

```bash
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume.get_api_resume_getResumeContactInfo' params='{"resumeId": "${id}"}'
```

## 🔗 相关接口

- [`get-resume-by-rid`](./get-resume-by-rid.md) - 获取简历基本信息（包含脱敏的联系方式）
- [`search-campus-resume`](./search-campus-resume.md) - 简历搜索接口

## ⚠️ 注意事项

1. **权限要求**: 
   - 必须已登录招聘系统
   - 需要有"查看联系方式"权限
   - 无权限时返回 403 错误
2. **敏感信息保护**: 
   - 本接口返回完整的手机号和邮箱
   - 请妥善保管，不得泄露给无关人员
   - 建议记录访问日志，用于审计
3. **与基本信息接口的区别**:
   - `getResumeByRid` 返回脱敏的联系方式（如 `138****8888`）
   - 本接口返回完整的联系方式（如 `13812345678`）
4. **批量获取建议**: 
   - 使用 `Promise.all` 并行请求
   - 建议添加错误处理，部分失败不影响其他请求
   - 注意权限检查，避免无权限时大量报错
5. **参数类型**: `resumeId` 必须是数字，不能是字符串类型的 `rid`

## 🤔 常见问题

**Q: 为什么获取联系方式需要单独的接口？**

A: 联系方式属于敏感信息，需要额外的权限验证。基本信息接口只返回脱敏的联系方式，完整信息需要通过本接口获取。

**Q: 如果没有权限会怎样？**

A: 返回 403 错误，`msg` 为 "无权查看联系方式"。请确保当前账号有查看联系方式的权限。

**Q: 紧急联系人信息是必填的吗？**

A: 不一定，部分候选人可能未填写紧急联系人信息，字段可能为空。

**Q: 可以通过 rid 直接获取联系方式吗？**

A: 不可以，本接口只接受 `resumeId` 参数。需要先通过 `getResumeByRid` 获取 `resumeId`。

**Q: 获取联系方式会被记录吗？**

A: 是的，系统会记录查看联系方式的操作日志，用于安全审计。

## 📖 相关文档

- [简历详情接口分析报告](../reports/resume-detail-apis.md) - 完整的简历详情接口清单
- [简历筛选手册](../guides/resume-filtering-manual.md) - 返回筛选导航
- [数据安全与隐私保护](../guides/data-security.md) - 敏感信息处理规范
