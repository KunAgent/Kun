# 简历收藏与锁定操作

对校园招聘简历进行收藏或锁定操作，方便后续快速查看和管理。

---

## 1. 收藏简历

### 1.1 添加收藏

- **apiId**: `recruit.campus-resume-search.get_v1_favorite_addResume`
- **原始路径**: `GET /v1/favorite/addResume`
- **操作类型**: ⚠️ 写操作
- **说明**: 将简历加入当前登录用户的收藏列表。操作幂等，重复收藏同一简历不报错。

#### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `resumeId` | number | ✅ | 简历数字 ID（搜索接口返回的 `data.list[].id` 字段），不能为空且不能为 0 |

> ⚠️ **`resumeId` 是数字 `id`，不是 `rid`（UUID）**。搜索接口每条简历同时返回 `id`（数字）和 `rid`（UUID），收藏接口使用 `id`。

#### MCP 调用

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.get_v1_favorite_addResume' \
  params='{"resumeId": ${resumeId}}'
```

#### 返回示例

```json
{
  "message": "",
  "status": 0,
  "data": {
    "favorite": 1
  }
}
```

**字段说明**：
- `status`: 0 表示请求成功
- `favorite`: 1 表示收藏成功

### 1.2 查询收藏状态

- **原始路径**: `GET /v1/favorite/favoriteResumeStatus`
- **说明**: 查询简历是否已被当前用户收藏

> ⚠️ 此接口**未在 MCP 上注册**，无法通过 mcporter 调用。仅供前端使用。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `resumeId` | number | ✅ | 简历ID |

返回 `data.status`: 1 = 已收藏，0 = 未收藏

### 1.3 取消收藏

> ⚠️ 取消收藏接口**未在 MCP 上注册**，无法通过 mcporter 调用。

---

## 2. 锁定简历

### 2.1 锁定校招简历

- **apiId**: `recruit.campus-resume-search.post_v1_resumeRecommend_lockCampusResume`
- **原始路径**: `POST /v1/resumeRecommend/lockCampusResume`
- **操作类型**: ⚠️ 写操作（会改变简历流程状态）
- **说明**: 根据简历 RID 将指定简历锁定给当前登录用户。`staffId` 自动取当前登录用户，`bgId` 自动取当前登录用户所在 BG。锁定成功后简历状态变为"已锁定"。

#### 输入参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `rid` | string | ✅ | 简历 RID（UUID 格式，如 `f012efe2-81f2-4a1f-bb95-811c1354d5ec`），不能为空 |

> ⚠️ **锁定接口使用 `rid`（UUID），不是数字 `id`**。与收藏接口使用的参数类型不同。

#### MCP 调用

```bash
mcporter call recruit-mcp CallAPI \
  apiId='recruit.campus-resume-search.post_v1_resumeRecommend_lockCampusResume' \
  params='{"rid": "${rid}"}'
```

#### 返回示例

```json
{
  "message": "",
  "status": 0,
  "data": "锁定成功"
}
```

**字段说明**：
- `status`: 0 表示请求成功
- `data`: 成功提示文本

---

## 3. 收藏 vs 锁定 对比

| 维度 | 收藏 | 锁定 |
|------|------|------|
| **影响范围** | 仅个人收藏列表 | 改变简历流程状态，影响所有用户 |
| **参数** | `resumeId`（数字 ID） | `rid`（UUID 字符串） |
| **可逆性** | 轻量，可取消（前端操作） | 较重，需要解锁流程 |
| **幂等性** | ✅ 重复收藏不报错 | ⚠️ 已锁定的简历再次锁定行为待确认 |
| **对其他用户影响** | 无 | 其他面试官暂时无法操作该简历 |
| **典型场景** | 标记感兴趣的候选人，后续查看 | 准备发起面试，占住候选人 |

---

## 4. 使用流程

### 推荐流程

```
1. 搜索简历 → 获取候选人列表（含 id 和 rid）
2. 粗读 & 精读 → 评估候选人
3. 收藏 → 对感兴趣的候选人添加收藏（轻量标记）
4. 锁定 → 确定要面试的候选人，锁定简历（重操作）
```

### 参数获取

- **`resumeId`（收藏用）**：搜索接口返回的 `data.list[].id`（数字）
- **`rid`（锁定用）**：搜索接口返回的 `data.list[].rid`（UUID 字符串）

---

## 5. 注意事项

1. **收藏操作是用户维度的**：每个用户有独立的收藏列表，不影响其他用户
2. **锁定操作会改变简历状态**：锁定后 `flowStatus` 变为 1（已锁定），其他面试官在列表中会看到状态变化
3. **参数类型不同**：收藏用数字 `id`，锁定用字符串 `rid`，不要混淆
4. **权限要求**：两个操作都需要面试官权限（连接走太湖授权；面试官权限到 hrright.woa.com 申请）
5. **MCP 可用性**：收藏状态查询和取消收藏接口未在 MCP 注册，仅收藏添加和锁定可通过 mcporter 调用
