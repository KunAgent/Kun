# 未读简历筛选（isUnRead + viewedDays）🔍

过滤掉近期已查看过的简历，只返回未读简历。

## 📋 参数信息

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `isUnRead` | `number` | ❌ 否 | `0` | 是否只看未读简历（1=是） |
| `viewedDays` | `number` | ❌ 否 | `null` | "已读"的时间窗口（天数），N 天内查看过的算"已读" |

## 🔴 关键：必须组合使用

**单独使用任一参数不起作用，两个参数必须同时设置才能过滤已读简历。**

### 实测验证结果

| 条件 | 效果 |
|------|------|
| 都不传 | 返回所有简历（含已读） |
| 只传 `isUnRead=1` | ❌ 无效，结果与不传一样 |
| 只传 `viewedDays=7` | ❌ 无效，结果与不传一样 |
| `isUnRead=1` + `viewedDays=N` | ✅ 过滤掉 N 天内查看过的简历，只返回 `isRead: false` 的 |

### 业务逻辑

1. `isUnRead=1` — 开启未读过滤模式
2. `viewedDays=N` — 定义"已读"的时间窗口（N 天内查看过 = 已读）
3. 两者组合：系统过滤掉 N 天内被查看过的简历，只返回未读简历

### viewedDays 的窗口效果

`viewedDays` 值需要 **≥ 实际查看天数** 才能过滤掉对应的已读简历。例如：
- 一条简历 10 天前被查看 → `viewedDays=7` 过滤不掉（超出窗口），`viewedDays=14` 可以过滤
- 建议使用较大的值（如 30、60、90）以确保覆盖更多已读简历

可用的 viewedDays 枚举值可通过字典接口获取（`types=ResumeViewedDays`）。

## 💡 使用示例

```json
{
  "isUnRead": 1,
  "viewedDays": 30,
  "keyword": "推荐系统",
  "graduate_time_begin": "2027-01-01",
  "graduate_time_end": "2027-12-31",
  "startInterviewEnable": 1
}
```

## ⚠️ 注意事项

1. **必须同时传两个参数**：只传其中一个，过滤不会生效
2. **viewedDays 是时间窗口**：值越大，过滤掉的已读简历越多
3. 生效时，返回结果中所有简历的 `isRead` 字段均为 `false`
4. 可与其他筛选条件（keyword、schoolLevel 等）同时使用，是 AND 关系
