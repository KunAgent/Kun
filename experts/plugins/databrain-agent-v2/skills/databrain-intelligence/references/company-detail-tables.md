# Company Detail Table Reference

> Coverage: Crunchbase-style company directory — resolve `publisher_id` / `developer_id` (or a company name) into a full company profile
> Database: `common` schema, `database_uuid = 15000`

Related: see [game-detail-tables.md](game-detail-tables.md) for game metadata; `app_detail.publisher_id` / `developer_id` and `combined_detail.publisher_id` / `developer_id` are the foreign keys into this table's `uuid`.

---

## Table of Contents

- [Source Overview](#source-overview)
- [Tables](#tables)
  - [company_details](#company_details)
- [Foreign Key Relationships](#foreign-key-relationships)
- [Key Dimensions](#key-dimensions)
- [Common Query Patterns](#common-query-patterns)
- [Pitfalls & Notes](#pitfalls--notes)

---

## Source Overview

| Table | Grain | Primary Key | Cluster Key |
|-------|-------|-------------|-------------|
| `common.company_details` | One row per company | `uuid` (unique) | `uuid` |

**When to use:**

| Scenario | Key |
|----------|-----|
| Known `publisher_id` / `developer_id` — need company profile | `company_details.uuid = <id>` |
| Known company name — need profile | `LOWER(name) = '<name>'` or `LIKE '%...%'` |
| Rank gaming companies by funding / headcount / country | filter on `category_groups LIKE '%Gaming%'` |
| Enrich a leaderboard with publisher country / size | JOIN via `app_detail.publisher_id` → `uuid` |
| Track M&A (acquirer, IPO, went-public) | `acquirer_identifier_*` / `ipo_status` / `went_public_on` |

---

## Tables

### company_details

**Company profile** — Crunchbase-style organization data with headquarters, founding, funding, IPO, acquisition, investor activity, and social links.

**Full table**: `common.company_details`

> **Field name quick ref** — common mistakes:
> - Company name column is **`name`** — NOT `company_name`, NOT `entity_name` (both raise `Unrecognized name` errors). Filter: `WHERE LOWER(name) LIKE '%..%'`
> - Primary key is **`uuid`** — NOT `company_id`, NOT `entity_id` (both do not exist). Filter: `WHERE uuid = '<company_uuid>'`
> - **There is NO intermediate join table** like `app_developer_publisher` or similar. The only way to link a company to its games is directly via `app_detail.publisher_id` / `developer_id` → `company_details.uuid`:
> ```sql
> -- CORRECT: direct JOIN, no intermediate table needed
> LEFT JOIN common.company_details pub ON pub.uuid = SPLIT(ad.publisher_id, '|')[SAFE_OFFSET(0)]
> LEFT JOIN common.company_details dev ON dev.uuid = SPLIT(ad.developer_id, '|')[SAFE_OFFSET(0)]
> -- WRONG: common.app_developer_publisher (does not exist)
> -- WRONG: cd.company_id (column does not exist, use cd.uuid)
> ```

#### Identity / Basics

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | STRING | UUID (primary key) |
| `permalink` | STRING | Crunchbase permalink slug |
| `name` | STRING | Company name |
| `aliases` | STRING | Aliases |
| `publishers` | STRING | Publishers (mostly NULL — do not rely on this field) |
| `legal_name` | STRING | Legal name |
| `image_id` | STRING | Image ID |
| `image_url` | STRING | Company logo URL |
| `short_description` | STRING | Short description |
| `description` | STRING | Long description |

#### Location

| Field | Type | Description |
|-------|------|-------------|
| `location_identifiers_city` | STRING | City |
| `location_identifiers_region` | STRING | State / province |
| `location_identifiers_country` | STRING | Country (e.g. `China`, `United States`, `Singapore`) |
| `location_identifiers_continent` | STRING | Continent |
| `location_group_identifiers` | STRING | Location group identifier |

#### Founders

| Field | Type | Description |
|-------|------|-------------|
| `founder_identifiers_uuid` | STRING | Founder UUID(s), pipe-delimited |
| `founder_identifiers_permalink` | STRING | Founder permalink(s) |
| `founder_identifiers_value` | STRING | Founder name(s) |
| `founded_on` | STRING | Founded date (`YYYY-MM-DD` **string, NOT DATE**) |

#### Classification

| Field | Type | Description |
|-------|------|-------------|
| `num_employees_enum` | STRING | Employee bucket (see [Key Dimensions](#key-dimensions)) |
| `category_groups` | STRING | Category groups (`<SEP>`-delimited, e.g. `Gaming<SEP>Software<SEP>Media and Entertainment`) |
| `categories` | STRING | Sub-categories, also `<SEP>`-delimited |
| `facet_ids` | STRING | Facet IDs |
| `company_type` | STRING | `For Profit` / `Non-profit` / NULL |

#### Contact & Social

| Field | Type | Description |
|-------|------|-------------|
| `contact_email` | STRING | Contact email |
| `phone_number` | STRING | Phone |
| `website` | STRING | Website |
| `twitter` | STRING | Twitter URL |
| `facebook` | STRING | Facebook URL |
| `linkedin` | STRING | LinkedIn URL |

#### Operating / IPO

| Field | Type | Description |
|-------|------|-------------|
| `operating_status` | STRING | `Active` / `Closed` / NULL |
| `ipo_status` | STRING | IPO status |
| `went_public_on` | DATETIME | IPO date |
| `exited_on` | DATETIME | Exit date |
| `stock_exchange_symbol` | STRING | Stock exchange code |
| `stock_symbol` | STRING | Ticker symbol |

#### Funding (raised by this company)

| Field | Type | Description |
|-------|------|-------------|
| `last_funding_type` | STRING | Last funding round type |
| `funding_total` | INT64 | Total funding raised (USD) |
| `num_funding_rounds` | INT64 | Number of funding rounds |
| `num_investors` | INT64 | Number of investors |
| `num_lead_investors` | INT64 | Number of lead investors |
| `valuation` | INT64 | Valuation (USD) |

#### Investing-side activity (when this company is itself an investor)

| Field | Type | Description |
|-------|------|-------------|
| `investor_type` | STRING | Investor type |
| `investor_stage` | STRING | Investor stage |
| `num_investments` | INT64 | Investments made |
| `num_lead_investments` | INT64 | Lead investments |
| `num_diversity_spotlight_investments` | INT64 | Diversity-spotlight investments |
| `num_funds` | INT64 | Number of funds |
| `num_exits` | INT64 | Number of exits |

#### Acquisition

| Field | Type | Description |
|-------|------|-------------|
| `acquirer_identifier_uuid` | STRING | Acquirer UUID |
| `acquirer_identifier_permalink` | STRING | Acquirer permalink |
| `acquirer_identifier_value` | STRING | Acquirer name |
| `num_acquisitions` | INT64 | Number of acquisitions made (as acquirer) |

#### Org counts

| Field | Type | Description |
|-------|------|-------------|
| `num_current_positions` | INT64 | Current positions |
| `num_sub_organizations` | INT64 | Sub-organizations |
| `num_current_advisor_positions` | INT64 | Current advisor positions |
| `num_articles` | INT64 | Articles |
| `num_event_appearances` | INT64 | Event appearances |

#### Metadata

| Field | Type | Description |
|-------|------|-------------|
| `create_time` | DATETIME | Create time |
| `update_time` | DATETIME | Update time |
| `insert_time` | DATETIME | Insert time |
| `ext1` / `ext2` / `ext3` | STRING | Extension fields |
| `source_description` | STRING | Source description |

---

## Foreign Key Relationships

| Source column | Target column | Notes |
|---------------|---------------|-------|
| `common.app_detail.publisher_id` | `common.company_details.uuid` | Single UUID, or pipe-delimited list when multi-publisher |
| `common.app_detail.developer_id` | `common.company_details.uuid` | Same |
| `common.combined_detail.publisher_id` | `common.company_details.uuid` | Same |
| `common.combined_detail.developer_id` | `common.company_details.uuid` | Same |

Multi-publisher rows look like `uuid1|uuid2|uuid3` — use `SPLIT` + `UNNEST` before joining (see [Pattern #3](#3-multi-publisher-publisher_id--split--unnest-then-join)).

---

## Key Dimensions

### operating_status values

- `Active`
- `Closed`
- NULL

### company_type values

- `For Profit`
- `Non-profit`
- NULL

### num_employees_enum values (standard buckets)

- `1-10`
- `11-50`
- `51-100`
- `101-250`
- `251-500`
- `501-1000`
- `1001-5000`
- `5001-10000`
- `10001+`

> A small number of rows carry raw numeric strings (e.g. `4`, `50`, `100`) instead of bucket labels — filter explicitly when aggregating by bucket.

### category_groups delimiter

- **Separator is `<SEP>`, NOT `|`** (e.g. `Gaming<SEP>Software<SEP>Media and Entertainment`)
- Same for `categories`

### uuid format

- Typically UUIDv4 (e.g. `3cae090b-ed2d-95f8-79a9-e32ca480258f`)
- Some entries use custom prefixes (e.g. Cognosphere's `mhy954e5-e1a5-4df2-b551-1eda6d329f3c`)
- Treat as opaque STRING — do not validate the format

---

## Common Query Patterns

### 1. Company profile by name

```sql
SELECT name, legal_name, location_identifiers_country,
       founded_on, num_employees_enum,
       operating_status, ipo_status, funding_total,
       website, linkedin
FROM common.company_details
WHERE LOWER(name) IN ('mihoyo', 'hoyoverse', 'cognosphere pte. ltd.')
ORDER BY funding_total DESC NULLS LAST
```

### 2. Direct JOIN from `app_detail` (single-publisher case)

```sql
SELECT ad.entity_name,
       ad.publisher,
       cd.name,
       cd.location_identifiers_country,
       cd.num_employees_enum,
       cd.founded_on,
       cd.operating_status
FROM common.app_detail ad
LEFT JOIN common.company_details cd
  ON cd.uuid = ad.publisher_id
WHERE ad.entity_name = 'Genshin Impact'
  AND ad.id_type = 'unified_id'
```

### 3. Multi-publisher `publisher_id` — SPLIT + UNNEST, then JOIN

```sql
WITH pubs AS (
  SELECT ad.entity_name,
         TRIM(pid) AS publisher_uuid
  FROM common.app_detail ad,
       UNNEST(SPLIT(ad.publisher_id, '|')) AS pid
  WHERE ad.id_type = 'unified_id'
    AND ad.publisher_id IS NOT NULL
    AND ad.publisher_id != ''
    AND ad.app_id = 'uf0a4c651423effde0425337ca0a2fd51'
)
SELECT p.entity_name, cd.name, cd.location_identifiers_country,
       cd.num_employees_enum, cd.founded_on
FROM pubs p
LEFT JOIN common.company_details cd ON cd.uuid = p.publisher_uuid
```

### 4. Leaderboard × publisher profile (country / size pivot)

```sql
SELECT d.entity_name,
       d.publisher,
       cd.location_identifiers_country AS publisher_country,
       cd.num_employees_enum           AS publisher_size,
       SUM(s.revenue) AS revenue
FROM intelligence.game_metric_sensortower_monthly_uid s
LEFT JOIN common.app_detail d
  ON d.app_id = s.id AND d.id_type = 'unified_id'
LEFT JOIN common.company_details cd
  ON cd.uuid = SPLIT(d.publisher_id, '|')[SAFE_OFFSET(0)]
WHERE s.date = '2026-03-01' AND s.market = 'global'
GROUP BY d.entity_name, d.publisher, publisher_country, publisher_size
ORDER BY revenue DESC
LIMIT 50
```

### 5. Top-funded gaming companies

```sql
SELECT name, location_identifiers_country, num_employees_enum,
       founded_on, funding_total, num_funding_rounds, ipo_status
FROM common.company_details
WHERE category_groups LIKE '%Gaming%'
  AND operating_status = 'Active'
  AND funding_total IS NOT NULL
ORDER BY funding_total DESC
LIMIT 50
```

### 6. Category expansion (`<SEP>`-delimited)

```sql
SELECT name, TRIM(cat) AS category_group, location_identifiers_country
FROM common.company_details,
     UNNEST(SPLIT(category_groups, '<SEP>')) AS cat
WHERE category_groups IS NOT NULL
  AND TRIM(cat) = 'Gaming'
  AND operating_status = 'Active'
ORDER BY funding_total DESC NULLS LAST
LIMIT 50
```

---

## Pitfalls & Notes

1. **Category delimiter is `<SEP>`, not `|`**: `category_groups` and `categories` use `<SEP>`. Filter gaming companies with `category_groups LIKE '%Gaming%'`, or expand with `SPLIT(category_groups, '<SEP>')` + `UNNEST`.

2. **`founded_on` is STRING** (format `YYYY-MM-DD`). Parse with `PARSE_DATE('%Y-%m-%d', founded_on)` when DATE semantics are required, or rely on lexical comparison.

3. **`uuid` is not always strict UUIDv4**: custom-prefixed IDs exist (e.g. Cognosphere's `mhy954e5-...`). Treat as opaque STRING — do not validate the format.

4. **`publisher_id` / `developer_id` from game tables may be pipe-delimited multi-value**: direct `ON cd.uuid = ad.publisher_id` only matches single-value rows. For multi-publisher rows, use `SPLIT` + `UNNEST` (Pattern #3), or take the primary publisher via `SPLIT(publisher_id, '|')[SAFE_OFFSET(0)]` (Pattern #4).

5. **No partition; full scan on non-`uuid` filters**: only `CLUSTER BY uuid` exists. UUID point lookups are fast; any other filter (country / category / name) scans the full table. Always add `LIMIT` and prefer narrowing by `category_groups` or `operating_status`.

6. **`company_details.publishers` is almost always NULL**: to find games published by a company, reverse-lookup via `app_detail.publisher_id = <uuid>` instead.

7. **Funding / investor counts may be NULL even for well-known companies**: many private companies have NULL `funding_total`. Always `ORDER BY funding_total DESC NULLS LAST` and report NULL as "not disclosed" rather than zero.

8. **`operating_status` is often NULL**: when filtering for active companies, use `operating_status = 'Active'` (NULL rows are excluded). Use `COALESCE(operating_status, 'Active') != 'Closed'` if you want to include unknowns.

9. **Employee bucket has minor noise**: a few rows have raw numeric values (`4`, `50`, `100`) instead of bucket labels. Filter with `num_employees_enum IN ('1-10','11-50','51-100','101-250','251-500','501-1000','1001-5000','5001-10000','10001+')` when doing bucket-level aggregation.

10. **`company_details` has NO `company_id` column — primary key is `uuid`**: The `search_entity.py` API returns `entity_id` for companies; that value maps to `company_details.uuid`. **Never use `company_id` as a column name in this table — it does not exist.** The correct filter is `WHERE cd.uuid = '<entity_id>'`, and the correct JOIN from game tables is `ON cd.uuid = ad.publisher_id` (or `developer_id`).

11. **`INFORMATION_SCHEMA` query syntax**: To inspect a dataset's schema, use `common.INFORMATION_SCHEMA.COLUMNS` (dataset-qualified, no project prefix needed — the API adds the project automatically). Example: `SELECT column_name, data_type FROM common.INFORMATION_SCHEMA.COLUMNS WHERE table_name = 'company_details'`.
