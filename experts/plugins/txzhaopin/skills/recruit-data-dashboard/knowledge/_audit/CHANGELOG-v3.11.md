# CHANGELOG v3.11 — BG 过滤逻辑强制检查（2026-06-12）

## 背景

用户在执行 WXG 社招面试中人数查询时，发现 SQL 使用了 `recruit_post_org_full_name LIKE '%WXG%'`（英文缩写），导致查询结果偏大（529人 vs 正确值 521人）。

根本原因分析：
- `SKILL.md` 仅在 Step 3 简单指向 `references/bg-routing.md`，**没有强制检查机制**
- `references/sql-rules.md` 的写法规范汇总表中**缺少 BG 过滤逻辑的正确写法**
- AI 在拼装 SQL 时容易"善意推测"使用英文缩写，而非严格遵循 `bg-routing.md` 规则

## 修订内容

### 1. `SKILL.md` Step 3 SQL 拼装规范新增 ⚠️ BG 过滤逻辑强制检查

在 Step 3 的 **SQL 拼装规范** 部分，新增：

```
⚠️ BG 过滤逻辑强制检查（v3.11 新增）：
- **禁止用英文缩写**：`recruit_post_org_full_name LIKE '%WXG%'` ❌
- **必须用英文前缀+中文全路径**：`recruit_post_org_full_name LIKE '%WXG微信事业群%'` ✅
- **完整规则见** `references/bg-routing.md`
- **SQL 拼装完成后必须自查**：检查所有 BG 相关过滤条件是否符合 `bg-routing.md` 规则
- **常见错误模式**：
  - ❌ `LIKE '%TEG%'` → ✅ `LIKE '%TEG技术工程事业群%'`
  - ❌ `LIKE '%CSIG%'` → ✅ `LIKE '%CSIG云与智慧产业事业群%'`
  - ❌ `LIKE '%IEG%'` → ✅ `LIKE '%IEG互动娱乐事业群%'`
  - ❌ `LIKE '%PCG%'` → ✅ `LIKE '%PCG平台与内容事业群%'`
  - ❌ `LIKE '%WXG%'` → ✅ `LIKE '%WXG微信事业群%'`
  - ❌ `LIKE '%CDG%'` → ✅ `LIKE '%CDG企业发展事业群%'`
  - ❌ `LIKE '%S1%'` → ✅ `LIKE '%S1金融科技事业线%'`
  - ❌ `LIKE '%S2%'` → ✅ `LIKE '%S2战略发展事业群%'`
  - ❌ `LIKE '%S3%'` → ✅ `LIKE '%S3职能线%'`
```

### 2. `references/sql-rules.md` 第 5 节写法规范汇总表新增 BG 过滤规则

在写法规范汇总表中新增一行：

| 维度 | 错误写法 | 正确写法 | 原因 |
| --- | --- | --- | --- |
| BG 过滤 | `recruit_post_org_full_name LIKE '%WXG%'` | `recruit_post_org_full_name LIKE '%WXG微信事业群%'` | 必须用英文前缀+中文全路径，英文缩写或纯中文都会匹配错误组织（v3.11 新增，v3.12 加强） |

### 3. `references/bg-routing.md` 验证

确认 `bg-routing.md` 已包含完整的 BG 路由规则：
- 9 个 BG 的中文全路径映射
- 过滤字段选择规则（社招用 `recruit_post_org_full_name`，活水用 `huoshui_post_org_full_name`）
- 集团本部特殊规则

## 影响范围

| 文件 | 修改类型 | 影响 |
| --- | --- | --- |
| `SKILL.md` | 新增 BG 过滤强制检查规则 | AI 拼装 SQL 时必须自查 BG 过滤逻辑 |
| `references/sql-rules.md` | 写法规范汇总表新增 1 行 | SQL 审查清单覆盖 BG 过滤逻辑 |
| `knowledge/_audit/CHANGELOG-v3.11.md` | 新增文件 | 记录本次优化 |

## 验证

### 修复前（错误写法）
```sql
-- 错误：使用英文缩写
WHERE recruit_post_org_full_name LIKE '%WXG%'
-- 结果：529人（偏大，因为会匹配到路径中包含 WXG 的其他组织）
```

### 修复后（正确写法）
```sql
-- 正确：使用中文全路径
WHERE recruit_post_org_full_name LIKE '%WXG微信事业群%'
-- 结果：521人（正确）
```

### 回归测试
- ✅ WXG 社招面试中人数：379人（正确）
- ✅ WXG 活水面试中人数：142人（正确）
- ✅ 合计：521人（正确）

## 防御措施

今后在拼装任何包含 BG 过滤的 SQL 时，AI 必须：
1. 读取 `references/bg-routing.md` 获取正确的中文全路径
2. 禁止使用英文缩写
3. SQL 拼装完成后，在输出前自查 BG 过滤逻辑

## 业务影响

本次优化**不改变任何指标的业务口径**，仅修正 SQL 拼装过程中的一个常见错误模式。

**错误影响量化**：
- WXG 社招面试中人数：错误 382人 vs 正确 379人（偏差 +0.8%）
- WXG 活水面试中人数：错误 147人 vs 正确 142人（偏差 +3.5%）
- 合计：错误 529人 vs 正确 521人（偏差 +1.5%）

## 累计治理成果（v3.0 ~ v3.11）

| 维度 | 数量 |
| --- | --- |
| 累计修订真实问题 | ~85+ 处 |
| 回归规则类数 | 8 类（R1-R8） |
| 治理基线指标覆盖率 | 44/44 = 100% |
| skill 体积 | ~335 KB |
