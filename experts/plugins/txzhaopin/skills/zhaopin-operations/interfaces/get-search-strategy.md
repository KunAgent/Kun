# 获取搜索策略 - 获取当前搜索使用的策略版本

获取当前简历搜索使用的策略版本配置。搜索策略控制搜索算法的版本，可能影响搜索结果的排序和匹配逻辑。

## 接口信息

| 项目 | 值 |
|------|-----|
| URL | `/resume/campus/api/v1/resume/getSearchStrategy` |
| Method | GET |
| Content-Type | application/json |

## 输入参数

| 参数 | 类型 | 必填 | 来源 | 说明 |
|------|------|------|------|------|
| `_t` | number | ❌ | 时间戳 | 防止缓存的时间戳参数 |

## 输出结果

```json
{
  "message": "",
  "status": 0,
  "data": {
    "version": "V3",
    "strategy": "strategy-V3"
  }
}
```

| 字段 | 说明 |
|------|------|
| `status` | 状态码，0表示成功 |
| `data.version` | 策略版本号（如 V3） |
| `data.strategy` | 策略标识（如 strategy-V3） |

## MCP 调用

```bash
# 搜索策略（已合并到搜索接口）
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.post_v1_resume_search'
```

## MCP 调用

```bash
# 搜索策略（已合并到搜索接口）
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.post_v1_resume_search'
```

## 使用场景

### 在简历搜索中使用策略

在调用 `/resume/campus/api/v1/resume/search` 接口时，需要将策略传入 `searchStrategy` 参数：

```bash
# 搜索策略（已合并到搜索接口）
mcporter call recruit-mcp CallAPI apiId='recruit.campus-resume-search.post_v1_resume_search'
```

## 注意事项

- **必须在搜索前调用**：每次调用搜索接口前，建议先获取最新的搜索策略
- **策略依赖**：搜索接口的 `searchStrategy` 参数必须使用此接口返回的值
- **版本控制**：系统可能会升级搜索算法，通过策略版本号控制
- **影响范围**：策略版本可能影响搜索结果的排序、匹配逻辑、权重计算等
- **固定返回**：目前返回的策略版本为 V3（`{"version": "V3", "strategy": "strategy-V3"}`）
