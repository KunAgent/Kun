# 社招筛选字段速查表（仅列核心 10 个）

> 完整字段请查 `interfaces/search-social-resume.md`。本页仅作为快速参考，不详细展开。

## 硬约束类（禁止 AI 扩展）

| 字段名 | 用户说法 → 参数 | 示例 |
|---|---|---|
| `location` | "深圳" | `["深圳"]` |
| `expectLocation` | ⚠️ **不要手写**：v6.1.0 由 social_search.py 自动从 `location` 派生为双子请求 | — |
| `supportNoExpectCity` | "是否纳入期望城市为空？"用户决策 | `true` / `false`（默认） |
| `mustCompanies` ✨ v6.1.1 | "只要字节/腾讯的"（用户明指公司，来自 `profile.must.companies`） | `["字节跳动","腾讯"]`（**写在 `common_params`，脚本自动下发到所有 route 的 allCompany**） |
| `workYearStart / workYearEnd` | "5-8 年" | `5 / 8` |
| `minDegree` | "本科及以上" | `"本科"` |
| `schoolLevelTags` | "985/211" | `["985","211"]` |
| `ageStart / ageEnd` | "28 岁以下" | `null / 28` |

## 扩展类（允许 AI 扩展）

| 字段名 | 用户说法 → 参数 | 扩展规则 |
|---|---|---|
| `searchKey` | 核心经验/领域/项目 | 同义词 + 空格分隔，`searchKeyUseAnd` 控制 AND/OR |
| `positionTags` | 职位类型 | 可加相近职位，如"算法"+"数据" |
| `skillTags` | 技能 | 可加相关技能，如"推荐算法"+"召回" |
| `allCompany` | **v6.1.0：泛行业场景必填（公司锚定路）** / **v6.1.1：`mustCompanies` 由脚本自动注入到此字段** | 公司锚定路专用，写 10-20 家领头公司；不是逗号字符串而是数组 `["网易","米哈游"]`。**用户明指公司时不要写到某条 route 的 allCompany，改用 `common_params.mustCompanies`** |

## 字段命名规则（避免与校招混淆）

- **社招用驼峰**：`searchKey`、`workYearStart`、`currentCompany`、`schoolLevelTags`
- **校招用下划线**：`keyword`、`work_city`、`education`、`schoolLevel`
- **不要混用**！如果你在写社招 params 但用了蛇形命名，搜索一定 0 结果。

## v6.1.0 城市字段三选一决策树

```
用户是否指定了城市？
  ├─ 否 → location / expectLocation 都不填
  └─ 是 → location 填用户指定城市
          └─ 询问用户："是否纳入期望城市为空的候选？"
              ├─ 是 → supportNoExpectCity=true（推荐，召回更广）
              └─ 否 → supportNoExpectCity=false（默认，保守）
```
**`expectLocation` 永远不手写**——脚本会从 `location` 自动派生做双子请求。
