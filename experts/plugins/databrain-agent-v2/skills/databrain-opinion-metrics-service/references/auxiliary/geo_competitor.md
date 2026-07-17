# geo_competitor — 国家 / 地区 / 语言 / 竞品 / 运营事件

> 适用：用户问"法国玩家""美国市场""西欧""LATAM""竞品"等场景。
>
> 涉及 `feeds.country` / `feeds.language` 字段语义 + `common.country_region` / `common.unified_competitor` / `common.game_event` 三张辅助表。
>
> 元数据速查：`common.country_region` 是 **VIEW（无物理分区/聚簇）**；`common.unified_competitor` **无分区，CLUSTER BY `unified_id`**；`common.game_event` **无分区，CLUSTER BY `start_time`**。

---

## 1. `country` 字段（feeds / kol / 商店表通用）

**类型**：STRING，**ISO 3166-1 alpha-2 小写**（如 `us` / `fr` / `de` / `it` / `no` / `gb` / `jp`）。

### ⚠️ `country='global'` 70%+ 数据陷阱（**最高频错误**）

`feeds.country='global'` 是**无国家归属**的特殊占位值：YouTube keyword / TikTok / Bilibili 等渠道的 `country` 字段**大量标 `'global'`**，实际地区只能靠 `language` 区分。

**实测证据**：
- POE2 2026-04-30~05-06：`country='global'` 占社媒总量 **86%**（26472 / 30857）
- AOV 2024-02-06~13 TW/VN/TH 相关 40 条中**仅 4 条标 tw/vn/th**，其余 36 条标 `'global'`（`language` 为 `zh-tw` / `vi` / `th`）

### 标准过滤模板（按特定国家查时务必用这个）

```sql
-- BAD：只过滤 country，会漏 80%+ 数据
WHERE country = 'fr'

-- ✅ GOOD：兜住 global + 用 language 二次区分
WHERE country IN ('fr', 'global')
  AND language = 'fr'
```

### Agent 对话建议

用户问"法国玩家""美国市场"等地域问题时，结果中**同时报告**：
- 命中指定国家的量（`country IN ('fr', ...)`）
- 同期 `country='global'` 的量（无国家归属，可能也含目标地区）
- 同期总量 → 覆盖率 = 命中 / 总量

否则用户会误以为"法国数据这么少"。

---

## 2. 常用地区组（小写 ISO 代码，可直接复制到 SQL `country IN (...)`）

### 2.1 西欧（Western Europe）

```sql
country IN ('de','fr','it','es','pt','nl','be','lu','at','ch','ie','gb','mc','li','ad','sm','va','mt')
```

| 代码 | 国家 | 代码 | 国家 |
|---|---|---|---|
| `de` | 德国 | `fr` | 法国 |
| `it` | 意大利 | `es` | 西班牙 |
| `pt` | 葡萄牙 | `nl` | 荷兰 |
| `be` | 比利时 | `lu` | 卢森堡 |
| `at` | 奥地利 | `ch` | 瑞士 |
| `ie` | 爱尔兰 | `gb` | 英国 |

### 2.2 北欧 / Nordic

```sql
country IN ('no','se','dk','fi','is')
```

`no` 挪威 / `se` 瑞典 / `dk` 丹麦 / `fi` 芬兰 / `is` 冰岛

### 2.3 法德意挪（用户常见组合）

```sql
country IN ('fr','de','it','no')
```

### 2.4 南欧

```sql
country IN ('it','es','pt','gr','cy','mt','si','hr','rs','al','mk','ba','me')
```

### 2.5 东欧

```sql
country IN ('pl','cz','sk','hu','ro','bg','ua','by','md','ru','lt','lv','ee')
```

### 2.6 北美 / NA

```sql
country IN ('us','ca','mx')
```

### 2.7 东亚

```sql
country IN ('jp','kr','cn','tw','hk','mo')
```

### 2.8 东南亚 / SEA

```sql
country IN ('th','vn','id','my','sg','ph','kh','la','mm','bn','tl')
```

### 2.9 南美 / LATAM（西语区）

```sql
country IN ('br','ar','cl','co','pe','ve','uy','bo','py','ec','mx','es')
```

### 2.10 大洋洲

```sql
country IN ('au','nz','fj','pg','sb','vu','to','ws')
```

### 2.11 中东 / MENA

```sql
country IN ('ae','sa','tr','il','eg','ma','jo','qa','kw','om','bh','iq','ir','lb')
```

### 2.12 全球（特殊值，不分国家时使用）

```sql
country = 'global'
```

---

## 3. `language` 字段

**类型**：STRING，**小写 ISO-2 / 简化代码**。

常见值：`en` / `zh` / `zh-hant`（繁体）/ `ja` / `ko` / `pt` / `ru` / `de` / `fr` / `es` / `it` / `nl` / `id` / `vi` / `th` / `tr` / `ar`。

⚠️ **`'cn'` 在某些表里出现（旧值）**：写 SQL 时建议用 `language IN ('zh','cn')` 兜底。

### "Only WEU countries no english" 类问题

```sql
WHERE country IN ('de','fr','it','es','pt','nl','be','lu','at','ch','ie','gb','mc','li','ad','sm','va','mt','global')
  AND language != 'en'
```

---

## 4. `common.country_region` — 国家 ↔ 地区映射表（辅助）

`tencent-databrain-prod.common.country_region` 提供 `country_code` ↔ 地区名 / 地区代码 的映射。常用于 join 后展示地区中文名。

```sql
SELECT
  f.country,
  cr.region_cn,            -- 中文地区名
  cr.region_code,
  COUNT(DISTINCT f.comment_uin) AS mentions
FROM `tencent-databrain-prod.opinion.public_feeds` AS f
LEFT JOIN `tencent-databrain-prod.common.country_region` AS cr
  ON LOWER(cr.country_code) = LOWER(f.country)
WHERE f.unified_edition_id = '<game_id>'
  AND f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
GROUP BY f.country, cr.region_cn, cr.region_code
ORDER BY mentions DESC
LIMIT 50;
```

> 字段名按表实际 schema 调整（`region_cn` / `region_name` / `region_en` 等）。

---

## 5. `common.unified_competitor` — 竞品列表

`tencent-databrain-prod.common.unified_competitor` 含每款游戏的官方竞品列表（`competitor_unified_id`，竖线分隔）。

```sql
-- 取某游戏的竞品列表
SELECT
  unified_id,
  entity_name,
  competitor_unified_id    -- 多个 unified_id 用 '|' 分隔的字符串
FROM `tencent-databrain-prod.common.unified_competitor`
WHERE unified_id = '<game_id>';

-- 展开成数组，再去查每个竞品的舆情
SELECT
  comp_id,
  COUNT(DISTINCT comment_uin) AS mentions
FROM (
  SELECT
    SPLIT(competitor_unified_id, '|') AS competitors
  FROM `tencent-databrain-prod.common.unified_competitor`
  WHERE unified_id = '<game_id>'
), UNNEST(competitors) AS comp_id
JOIN `tencent-databrain-prod.opinion.public_feeds` f
  ON f.unified_edition_id = comp_id
WHERE f.comment_time >= TIMESTAMP('<start_date>')
  AND f.comment_time <  TIMESTAMP_ADD(TIMESTAMP('<end_date>'), INTERVAL 1 DAY)
GROUP BY comp_id
ORDER BY mentions DESC;
```

---

## 6. `common.game_event` — 运营活动事件维表

`tencent-databrain-prod.common.game_event` 含各游戏的运营活动 / 版本更新事件（名称、描述、时间、URL，多游戏关联用 `UNNEST(games)`）。

```sql
-- 取某游戏在某时间段的运营活动事件
SELECT
  event_name, event_desc,
  event_start_time, event_end_time,
  event_url
FROM `tencent-databrain-prod.common.game_event`,
     UNNEST(games) AS g
WHERE g.game_id = '<game_id>'
  AND event_start_time >= TIMESTAMP('<start_date>')
  AND event_start_time <  TIMESTAMP('<end_date>')
ORDER BY event_start_time DESC;
```

> 字段名按表实际 schema 调整。

⚠️ **用户问"上线后"/"announcement 起算"/"event 起算"时**：必须先有具体日期。可以用本表查游戏的事件时间，或直接问用户给一个具体日期（详见 SKILL.md Phase 2.3 时间词翻译）。

---

## 7. 注意事项

1. **`country='global'` 占 70-86%**：按特定国家查务必 `country IN ('<target>','global') AND language=...`
2. **`country` / `language` 必须小写**：`'FR'` / `'France'` / `'EN'` 都 0 行
3. **`'cn'` 旧值**：建议 `language IN ('zh','cn')` 兜底
4. **西欧 / 北欧 / LATAM 列表注意是否含 `gb`**：英国是西欧（不在北欧）
5. **竞品 / 事件查询前都需要先有 game_id**：先 `game_search.py` 解析（详见 [id_mapping.md](id_mapping.md)）
