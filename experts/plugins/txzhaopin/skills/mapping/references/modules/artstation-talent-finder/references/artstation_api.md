# ArtStation API 参考

## 概述

ArtStation 提供了一组非官方的公开 JSON API，可用于搜索用户和作品。这些 API 不需要认证，但受到 Cloudflare 保护和频率限制。

> **重要**: 所有 API 端点均需设置正确的请求头（特别是 `Referer` 和 `User-Agent`），否则可能被 Cloudflare 拦截返回 403。

## API Endpoints

### 1. 搜索用户（主搜索方式）

```
GET https://www.artstation.com/api/v2/search/users.json
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词，如 `concept artist` |
| page | int | 否 | 页码，从 1 开始，默认 1 |
| per_page | int | 否 | 每页数量，最大 50，默认 20 |

**返回数据结构:**
```json
{
  "data": [
    {
      "id": 123456,
      "username": "artist_name",
      "full_name": "Artist Name",
      "headline": "Concept Artist at Studio",
      "city": "Shanghai",
      "country": "China",
      "medium_avatar_url": "https://cdn.artstation.com/...",
      "permalink": "https://www.artstation.com/artist_name",
      "followers_count": 5000,
      "skills": [{"name": "Concept Art"}, {"name": "Illustration"}]
    }
  ],
  "total_count": 350
}
```

**关键字段说明:**
- `username` — 用户名，用于构建 profile URL 和调用详情 API
- `permalink` — 完整个人主页链接
- `headline` — 用户一句话简介（岗位/公司等）
- `skills` — 技能标签数组，可用于后续过滤
- `total_count` — 搜索结果总数，用于计算分页

### 2. 搜索作品（降级方案）

```
GET https://www.artstation.com/api/v2/search/projects.json
```

**参数:**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 搜索关键词 |
| page | int | 否 | 页码，从 1 开始 |
| per_page | int | 否 | 每页数量，最大 50 |

**返回数据结构（关键字段）:**
```json
{
  "data": [
    {
      "id": 789012,
      "title": "Project Title",
      "permalink": "https://www.artstation.com/artwork/AbCdEf",
      "user": {
        "username": "artist_name",
        "full_name": "Artist Name",
        "headline": "Senior 3D Artist",
        "permalink": "https://www.artstation.com/artist_name"
      }
    }
  ],
  "total_count": 1200
}
```

**使用场景:** 当用户搜索 API 被限制或返回结果较少时，通过搜索作品来发现更多艺术家。脚本会自动对结果去重。

### 3. 用户详情（获取邮箱等信息）

```
GET https://www.artstation.com/users/{username}.json
```

**路径参数:**
- `{username}` — 用户名（从搜索结果的 `username` 字段获取）

**返回数据结构:**
```json
{
  "id": 123456,
  "username": "artist_name",
  "full_name": "Artist Name",
  "headline": "Senior Concept Artist",
  "about": "I'm a concept artist with 10 years of experience...\nContact: artist@email.com",
  "city": "Los Angeles",
  "country": "United States",
  "skills": [
    {"name": "Concept Art"},
    {"name": "Character Design"},
    {"name": "Digital Painting"}
  ],
  "software": [
    {"name": "Photoshop"},
    {"name": "ZBrush"}
  ],
  "social_profiles": [
    {"social_profile_type": "twitter", "url": "https://twitter.com/artist"},
    {"social_profile_type": "linkedin", "url": "https://linkedin.com/in/artist"}
  ],
  "followers_count": 15000,
  "following_count": 200,
  "projects_count": 45,
  "medium_avatar_url": "https://cdn.artstation.com/...",
  "large_avatar_url": "https://cdn.artstation.com/..."
}
```

**邮箱提取策略:**
1. **`about` 字段**（优先）— 正则匹配 `[\w.+-]+@[\w-]+\.[\w.-]+`，许多艺术家会在简介中留下联系邮箱
2. **`social_profiles` 字段**（备用）— 检查是否有 email 类型的社交链接

### 4. 用户作品列表

```
GET https://www.artstation.com/users/{username}/projects.json?page={n}
```

返回用户的作品列表，每页默认 20 条。

### 5. 关注列表

```
GET https://www.artstation.com/users/{username}/following.json?page={n}
```

返回用户关注的人列表，每页 20 条。可用于从知名艺术家出发发现更多候选人。

### 6. 快速用户信息

```
GET https://www.artstation.com/users/{username}/quick.json
```

返回精简的用户信息，比 `.json` 详情接口更快但数据更少。

---

## 请求头建议

```python
headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.artstation.com/",
    "Origin": "https://www.artstation.com",
    "sec-ch-ua": "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}
```

## Cloudflare 反爬对策

### Playwright 模式（推荐）
1. 启动 Chromium headless 浏览器
2. 先访问 `https://www.artstation.com/` 获取 Cloudflare 验证 Cookie
3. 在浏览器上下文中使用 `page.evaluate()` 执行 `fetch()` 请求 API
4. 等效于真实用户在浏览器中操作，能有效绕过 Cloudflare

### urllib 模式（备用）
1. 多套 User-Agent 轮换
2. 完整的浏览器指纹头（sec-ch-ua 等）
3. CookieJar 自动管理 Cookie
4. 请求间隔 ≥ 300ms，遇到 429/403 自动指数退避重试

## 注意事项

1. **频率限制**: 建议请求间隔 ≥ 300ms，遇到 429 错误时进行指数退避（最多 5 次重试）
2. **连续失败保护**: 如果连续 5 次请求失败（详情接口），自动停止以保护 IP
3. **数据时效**: API 返回实时数据，无缓存
4. **邮箱获取率**: 通常约 30-50% 的艺术家会在简介中公开邮箱
5. **版权合规**: 仅用于合法的人才搜寻目的，尊重用户隐私和平台规则

## 常用搜索关键词

### 按岗位
| 英文关键词 | 中文说明 |
|-----------|---------|
| `concept artist` | 概念设计师 |
| `3D character artist` | 3D 角色设计师 |
| `environment artist` | 环境/场景设计师 |
| `character designer` | 角色设计师 |
| `texture artist` | 贴图/材质设计师 |
| `animator` | 动画师 |
| `motion designer` | 动效设计师 |
| `matte painter` | 接景绘画师 |
| `VFX artist` | 视觉特效师 |
| `UI/UX designer` | 界面设计师 |
| `prop artist` | 道具设计师 |
| `vehicle designer` | 载具设计师 |
| `weapon designer` | 武器设计师 |
| `hard surface modeler` | 硬表面建模师 |
| `lighting artist` | 灯光师 |

### 按行业
| 英文关键词 | 中文说明 |
|-----------|---------|
| `game art` | 游戏美术 |
| `film concept` | 影视概念 |
| `automotive design` | 汽车设计 |
| `architectural visualization` | 建筑可视化 |
| `mobile game` | 手游美术 |
| `AAA game` | 3A 游戏 |

### 按工具/引擎
- `Unreal Engine` / `Unity`
- `ZBrush` / `Maya` / `Blender` / `3ds Max`
- `Substance Painter` / `Substance Designer`
- `Houdini` / `Nuke`
- `Photoshop` / `Procreate` / `Clip Studio Paint`

### 按风格
| 英文关键词 | 中文说明 |
|-----------|---------|
| `realistic` | 写实风格 |
| `stylized` | 风格化 |
| `cartoon` | 卡通风格 |
| `anime style` | 动漫风格 |
| `semi-realistic` | 半写实 |
| `photorealistic` | 超写实 |

### 组合搜索示例
- `realistic character artist` — 写实角色艺术家
- `stylized 3D character` — 风格化 3D 角色
- `concept art sci-fi` — 科幻概念设计
- `environment artist unreal` — UE 环境设计师
- `game animator unity` — Unity 游戏动画师
