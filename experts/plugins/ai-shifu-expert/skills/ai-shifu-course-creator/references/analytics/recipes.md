# Analytics Recipes

Ready-to-run templates, grouped by scenario. Most examples run through `shifu-cli.py analytics-query <bid> --dsl '…'` (the DSL path); the **Credit Consumption** section is the exception — it uses `shifu-cli.py credit-detail <bid> …` because `bill_daily_usage_metrics` is empty in production until the daily aggregation cron is enabled, so the DSL recipes there are deprecated. Substitute `<bid>` with the actual `shifu_bid` from `shifu-cli.py list` (or from a Course Metadata recipe below). Read `dsl.md` and `tables.md` first for grammar and field meanings.

For DSL recipes, the bodies omit `shifu_bid` — the CLI injects it from the positional argument. For `credit-detail`, all parameters are flags on the command line; see the Credit Consumption section below for the full reference.

## Course Metadata (resolve `shifu_bid ↔ current title`)

> Whenever the user mentions a course by **title**, resolve the current `shifu_bid → title` mapping via the metadata tables **before** issuing any downstream analytics query. The CLI's `shifu-cli.py list` is a one-shot draft snapshot — it does not detect rename history, does not distinguish current vs historical titles, and (most importantly) does not show whether the draft title has diverged from the live published title. The 2026-05-15 query handbook PDF documents the exact failure this prevents: reporting a historical title as the course's "current name" because it once appeared in the rename history.
>
> **Rules (read these before any title lookup):**
>
> 1. The current published title is the row in `shifu_published_shifus` with `deleted = 0`. Treat that title as authoritative for any answer the user sees.
> 2. If the published table has no `deleted = 0` row for the `shifu_bid`, fall back to `shifu_draft_shifus.deleted = 0` and tell the user the course is currently a draft (not live).
> 3. Historical titles (`deleted = 1` rows in either table) are **never** the answer to "this course is currently called …". When a user-supplied title only matches historical rows, say so explicitly: "this course used to be called X; it is currently called Y."
> 4. When matching by user-supplied keyword, normalize whitespace client-side (`replace(title, ' ', '')`) before comparing — the DB stores titles with whatever spacing the author used.

### Recipe 0a — Find my courses by current published title

The most common case: the user names a course you have not previously resolved this session.

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"shifu_published_shifus",
 "where":[{"field":"title","op":"like","value":"<keyword>%"}],
 "select":["title","created_user_bid","updated_at"],
 "limit":50
}'
```

> The keyword must be ≥ 2 non-wildcard characters (anti-enumeration guard); trailing `%` only. Returns titles for the **caller's own published courses** whose name starts with the keyword. The `<bid>` positional value is required by the CLI; pick any one of your `shifu_bid` values from `shifu-cli.py list` — the metadata query is still constrained to the caller's own rows by the auto-injected `created_user_bid` filter, but the CLI's positional argument also clamps `shifu_bid`, so for cross-course lookups you fan out one call per known `shifu_bid` and merge client-side. (Path: when the user has many courses, run Recipe 0a once per known `shifu_bid` from `list`, then aggregate.)

### Recipe 0b — Confirm the current title of a known `shifu_bid`

When you already have a `shifu_bid` (from a prior list / show call) and want to verify the live name:

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"shifu_published_shifus",
 "select":["title","created_user_bid","updated_at"],
 "limit":1
}'
```

> Returns at most one row (the current published title). Empty result = the course is not currently published; switch to Recipe 0c.

### Recipe 0c — Check the draft title when no published row exists

If Recipe 0b returns empty, the course is in draft (not yet published or unpublished). Look at the editor copy instead:

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"shifu_draft_shifus",
 "select":["title","created_user_bid","updated_at"],
 "limit":1
}'
```

> When the published title and the draft title disagree, surface both to the user — the discrepancy usually means a recent rename that has not been republished yet.

**CLI shortcut**: `shifu-cli.py find-title <keyword>` chains Recipes 0a → 0c on every course you own and prints a grouped Published / Draft-only / Historical table.

## Course Overview (one-stop popularity dashboard)

### Recipe 0d — Course overview: learners + orders + revenue + recent activity

Use this when the user wants a high-level snapshot of a course rather than one specific metric — the same set of numbers the admin dashboard shows (学员数 / 订单数 / 营收 / 最近活跃). Run these small queries and combine client-side; do **not** look for a single "stats" REST endpoint and do **not** open the admin dashboard in a browser — every one of these numbers comes from `analytics-query`.

```bash
# 1) Learner count (distinct learners who entered the course)
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_progress_records",
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"learners"}],
 "limit":1
}'

# 1b) Most-recent activity time (latest progress record; row-query, not max() — min/max are numeric-only)
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_progress_records",
 "select":["created_at"],
 "order_by":[{"field":"created_at","dir":"desc"}],
 "limit":1
}'

# 2) Paid order count + revenue (status = 502 paid; never use >=, it leaks refunds/pending)
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"order_orders",
 "where":[{"field":"status","op":"=","value":502}],
 "aggregate":[
   {"fn":"count","alias":"orders"},
   {"fn":"sum","field":"paid_price","alias":"revenue"}],
 "limit":1
}'

# 3) Active (non-archived) learner count
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"shifu_user_archives",
 "where":[{"field":"archived","op":"=","value":0}],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"active_learners"}],
 "limit":1
}'
```

口径说明（present these definitions alongside the numbers so they are unambiguous):

- **学员数 (learners)** = `count_distinct(user_bid)` on `learn_progress_records` — everyone who entered the course (Method ① in `tables.md`). This is the dashboard's "学员数".
- **订单数 (orders)** = `count` of `order_orders` rows with `status = 502` — paid orders (includes ¥0 free enrolments). For *strictly paid* (`paid_price > 0`) use Recipe 3; for the full funnel use Recipe 5.
- **营收 (revenue)** = `sum(paid_price)` over the same `status = 502` rows. Round to 2 decimals (`¥5,870.70`).
- **最近活跃 (last_active)** = the `created_at` of the latest `learn_progress_records` row (query 1b). Convert to local time before presenting.
- **活跃学员 (active_learners)** = non-archived learners (`shifu_user_archives.archived = 0`); usually ≤ 学员数 because some learners archived the course.

> Want only one of these? Use the focused recipe instead: learners → Recipe 1, orders/revenue → Recipe 3 / 5 / 6, active learners → Recipe 14. Recipe 0d is the bundle for "just show me everything at a glance".

## Progress

### Recipe 1 — Progress funnel

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_progress_records",
 "select":["status"],
 "group_by":["status"],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"n"}],
 "limit":10
}'
```

### Recipe 2 — Top 20 stuck lessons

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_progress_records",
 "where":[{"field":"status","op":"=","value":602}],
 "select":["outline_item_bid"],
 "group_by":["outline_item_bid"],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"stuck"}],
 "order_by":[{"field":"stuck","dir":"desc"}],
 "limit":20
}'
```

## Orders

### Recipe 3 — Paid buyers (price > ¥0) and revenue

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"order_orders",
 "where":[
   {"field":"status","op":"=","value":502},
   {"field":"paid_price","op":">","value":0}],
 "aggregate":[
   {"fn":"count_distinct","field":"user_bid","alias":"buyers"},
   {"fn":"sum","field":"paid_price","alias":"revenue"}],
 "limit":1
}'
```

### Recipe 4 — Free-enrolment count (paid but ¥0)

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"order_orders",
 "where":[
   {"field":"status","op":"=","value":502},
   {"field":"paid_price","op":"=","value":0}],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"zero_yuan"}],
 "limit":1
}'
```

### Recipe 5 — Order status distribution (funnel view)

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"order_orders",
 "select":["status"],
 "group_by":["status"],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"n"}],
 "limit":10
}'
```

### Recipe 6 — Payment channel breakdown (paid orders only)

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"order_orders",
 "where":[{"field":"status","op":"=","value":502}],
 "select":["payment_channel"],
 "group_by":["payment_channel"],
 "aggregate":[{"fn":"count","alias":"orders"},{"fn":"sum","field":"paid_price","alias":"revenue"}],
 "limit":20
}'
```

## Ratings

### Recipe 7 — Lowest-rated lessons

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_lesson_feedbacks",
 "select":["progress_record_bid"],
 "group_by":["progress_record_bid"],
 "aggregate":[{"fn":"avg","field":"score","alias":"avg_score"},{"fn":"count","alias":"n"}],
 "order_by":[{"field":"avg_score","dir":"asc"}],
 "limit":10
}'
```

> Each row's `progress_record_bid` must be translated to a chapter/lesson name via the two-step lookup in `tables.md` (ID Field Translation Rules).

## Credit Consumption (use `shifu-cli.py credit-detail`)

> **The DSL `bill_daily_usage_metrics` recipes that lived here previously are deprecated.** That table is currently empty in production because the daily aggregation Celery beat job is not registered. Use the `credit-detail` CLI command below — it joins `bill_usage` × `credit_ledger_entries` server-side and returns the real credit deduction for the requested shifu. When the daily aggregation job is eventually enabled, the DSL recipes can be reinstated for "by-day trend" queries; until then `credit-detail` is the only path.

### Recipe 8 — Today's credit consumption

```bash
python3 scripts/shifu-cli.py credit-detail <bid> --start 2026-05-16 --end 2026-05-16
```

Returns `summary` (total credits, distinct users / progress records, wallet creator, time range) plus `rows` (per-usage detail: created_at, user_bid, progress_record_bid, outline_item_bid, usage_type, usage_scene, provider, model, credits).

### Recipe 9 — Credits over an arbitrary date window

```bash
python3 scripts/shifu-cli.py credit-detail <bid> --start 2026-05-01 --end 2026-05-15
```

`start` / `end` are inclusive ISO dates; end must be on or after start.

### Recipe 10 — Production-only spend (exclude preview / debug)

```bash
python3 scripts/shifu-cli.py credit-detail <bid> --scene 1203
```

`--scene` accepts a comma-separated subset of `{1201, 1202, 1203}` (debug / preview / production). Combine with `--start` / `--end` to scope a window.

### Recipe 11 — LLM-only vs TTS-only

```bash
# LLM only
python3 scripts/shifu-cli.py credit-detail <bid> --usage-type 1101

# TTS only
python3 scripts/shifu-cli.py credit-detail <bid> --usage-type 1102
```

`--usage-type` accepts a comma-separated subset of `{1101, 1102}`.

### Recipe 12 — Pagination for large windows

```bash
python3 scripts/shifu-cli.py credit-detail <bid> --start 2026-05-01 --limit 200 --offset 200
```

`--limit` caps at 1000; the `summary` block always reflects the full filtered set regardless of paging.

### Recipe 13 — Reading the response

Pseudo-shape:

```json
{
  "code": 0,
  "data": {
    "summary": {
      "total_records":   52,
      "total_credits":   "26.6900",
      "unique_users":    1,
      "unique_progress": 5,
      "wallet_creator_bid": "029bacf0...",
      "time_range": ["2026-05-15 16:05:18", "2026-05-15 23:45:17"]
    },
    "rows": [
      {
        "usage_bid": "...",
        "created_at": "2026-05-15 23:45:17",
        "user_bid": "...",
        "progress_record_bid": "...",
        "outline_item_bid": "...",
        "usage_type":  1101,
        "usage_scene": 1203,
        "provider":    "deepseek",
        "model":       "deepseek-v4-flash",
        "credits":     "0.5100",
        "wallet_creator_bid": "029bacf0..."
      }
    ],
    "limit":  100,
    "offset": 0
  }
}
```

`total_credits` and per-row `credits` are decimal strings (preserved precisely from the ledger, no float rounding). Apply the standard translation rules before presenting: `outline_item_bid` → "Lesson X.Y: <title>"; `user_bid` → ordinal labels (Learner A / B / C) per `privacy-and-presentation.md`; round credits to 2 decimal places (e.g. `26.69 积分`).

## Active Learners

### Recipe 14 — Active learner count

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"shifu_user_archives",
 "where":[{"field":"archived","op":"=","value":0}],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"active_n"}],
 "limit":1
}'
```

## Audience Profile

### Recipe 15 — Single-variable distribution

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"var_variable_values",
 "where":[{"field":"variable_bid","op":"=","value":"<variable_bid>"}],
 "select":["value"],
 "group_by":["value"],
 "aggregate":[{"fn":"count_distinct","field":"user_bid","alias":"n"}],
 "order_by":[{"field":"n","dir":"desc"}],
 "limit":20
}'
```

> `value` may contain free-text PII — always aggregate, never `select` raw values without `group_by`. See `privacy-and-presentation.md`.

## Per-Learner Top-N

### Recipe 16 — Lessons completed per learner — Top N

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_progress_records",
 "where":[{"field":"status","op":"=","value":603}],
 "select":["user_bid"],
 "group_by":["user_bid"],
 "aggregate":[{"fn":"count","alias":"completed_n"}],
 "order_by":[{"field":"completed_n","dir":"desc"}],
 "limit":20
}'
```

> See the duplicate-row trap in `tables.md` — `count` on `learn_progress_records` can double-count re-taken lessons. State this caveat when presenting Top-N.

## Follow-up Q&A

> **All Recipe 17–22 templates below**: the API auto-filters `status = 1` on `learn_generated_blocks`. Rerolled-history blocks (`status = 0`) never appear in your counts. Do not add a `status = 1` clause yourself — it is redundant. Conversely, to count follow-up questions, always anchor on `type = 321`; **do not** key off `role = 2` (which also marks input / phone / checkcode widgets — see the trap in `tables.md`).

### Recipe 17 — Total follow-up questions + unique questioners

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[{"field":"type","op":"=","value":321}],
 "aggregate":[
   {"fn":"count","alias":"ask_count"},
   {"fn":"count_distinct","field":"user_bid","alias":"asker_users"}],
 "limit":1
}'
```

### Recipe 18 — Top N most active questioners

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[{"field":"type","op":"=","value":321}],
 "select":["user_bid"],
 "group_by":["user_bid"],
 "aggregate":[{"fn":"count","alias":"asks"}],
 "order_by":[{"field":"asks","dir":"desc"}],
 "limit":20
}'
```

### Recipe 19 — Full Q&A replay for a single lesson (audited, `limit ≤ 100`)

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[
   {"field":"type","op":"in","value":[321, 322]},
   {"field":"progress_record_bid","op":"=","value":"<progress_record_bid>"}],
 "select":["user_bid","generated_content","role","type","created_at"],
 "order_by":[{"field":"created_at","dir":"asc"}],
 "limit":100
}'
```

> Returns interleaved learner questions (`type = 321, role = 2`) and LLM answers (`type = 322, role = 1`) in chronological order. Every access is audited server-side.

### Recipe 20 — All follow-up questions by one learner (raw text, `limit ≤ 100`)

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[
   {"field":"type","op":"=","value":321},
   {"field":"user_bid","op":"=","value":"<target_user_bid>"}],
 "select":["user_bid","generated_content","progress_record_bid","created_at"],
 "order_by":[{"field":"created_at","dir":"desc"}],
 "limit":100
}'
```

### Recipe 21 — Latest LLM answers (evaluate model quality)

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[{"field":"type","op":"=","value":322}],
 "select":["generated_content","progress_record_bid","created_at"],
 "order_by":[{"field":"created_at","dir":"desc"}],
 "limit":100
}'
```

### Recipe 22 — Latest follow-ups with asker identity (3-step combo)

End-to-end view for "list the latest N follow-up questions with **who asked**, the answer, and timestamps". Uses three `analytics-query` calls — the second and third batch values pulled from the first — and is joined client-side by `user_bid` and the four-key tuple `(progress_record_bid, shifu_bid, outline_item_bid, position)`. `user_identify` always comes back masked (`138*****000`); a `nickname` containing a phone / email / ID number is redacted to `[REDACTED-XXX]`. Plain-text phone numbers are not retrievable through this API — see `privacy-and-presentation.md`.

Substitute `<N>` (default 10, ≤ 100) below; cap the user_users batch to 50 dedup'd `user_bid` values.

**Step 1 — fetch the latest N follow-up questions**

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[{"field":"type","op":"=","value":321}],
 "select":["user_bid","generated_content","progress_record_bid","outline_item_bid","position","created_at"],
 "order_by":[{"field":"created_at","dir":"desc"}],
 "limit":10
}'
```

Each row is one question: `(user_bid, question_text, progress_record_bid, outline_item_bid, position, asked_at)`. The 4-tuple `(progress_record_bid, outline_item_bid, position, asked_at)` is what you use to pair against the matching answer below.

**Step 2 — fetch the matching LLM answers**

Collect the distinct `progress_record_bid` values from Step 1 and pass them into `in`:

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[
   {"field":"type","op":"=","value":322},
   {"field":"progress_record_bid","op":"in","value":["<prb-1>","<prb-2>","..."]}],
 "select":["generated_content","progress_record_bid","outline_item_bid","position","created_at"],
 "order_by":[{"field":"position","dir":"asc"}],
 "limit":100
}'
```

> **Pairing rule (four-key, preferred)**: for each Step-1 question row with `(progress_record_bid = P, outline_item_bid = L, position = POS, asked_at = T)`, the matching answer is the Step-2 row with the same `(P, L)` and the smallest `position > POS`. The four-key tuple is what the platform stores deterministically — no time-of-day ambiguity, no race-condition surprises if two answers landed within the same second. Time-order is a **fallback** only used when `position` is missing on either side: pick the earliest Step-2 row with the same `(P, L)` and `created_at > T`. Each lesson can carry multiple Q&A turns under the same `progress_record_bid` — the `(L, POS)` pair is what distinguishes them.

**Step 3 — resolve the askers' nicknames and (masked) phones**

Collect the distinct `user_bid` values from Step 1 (dedup, max 50):

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"user_users",
 "where":[{"field":"user_bid","op":"in","value":["<u-bid-1>","<u-bid-2>","..."]}],
 "select":["user_bid","nickname","user_identify"],
 "limit":50
}'
```

Returns `(user_bid, nickname, user_identify)` rows. `nickname` is auto-redacted when it embeds a phone / email / ID; `user_identify` is always masked (phone → `138*****000`, email → `te*****@example.com`).

**Step 4 — assemble and present (client-side)**

Apply the Translation Gate in `privacy-and-presentation.md`:

- Never paste the raw `user_bid`; replace with ordinal labels (`Learner A / B / C`).
- Translate `progress_record_bid` to a chapter/lesson name via the two-step lookup in `tables.md`.
- Convert `created_at` to local-timezone (`2026-05-13 21:42`).
- Display the masked `user_identify` as-is — do not strip the `*****`.

Final shape per row:

> **Learner A (Python 学徒 · 138\*\*\*\*\*000)** asked in **Lesson 3.1 装饰器与闭包** at `2026-05-13 21:42`: "闭包和装饰器啥区别?" → AI answer: "闭包是…"

If the user starts from a phone number and wants to know which learner asked, run `privacy-and-presentation.md` Use B (`user_identify = "13800138000"` exact match) to get the `user_bid` first, then filter Step 1 by that `user_bid` (`{"field":"user_bid","op":"=","value":"<u-bid>"}`) — `in` / `like` / range on `user_identify` are rejected to prevent enumeration.

### Recipe 23 — Follow-up questions per lesson

Where are learners actually asking? Group `type = 321` by `outline_item_bid` to find which lessons drive follow-up traffic:

```bash
python3 scripts/shifu-cli.py analytics-query <bid> --dsl '{
 "table":"learn_generated_blocks",
 "where":[{"field":"type","op":"=","value":321}],
 "select":["outline_item_bid"],
 "group_by":["outline_item_bid"],
 "aggregate":[
   {"fn":"count","alias":"asks"},
   {"fn":"count_distinct","field":"user_bid","alias":"askers"}],
 "order_by":[{"field":"asks","dir":"desc"}],
 "limit":50
}'
```

> Translate each `outline_item_bid` to "Lesson X.Y: \<title\>" via the `shifu-cli.py show <bid>` outline cache before presenting. High-ask lessons are usually candidates for content reinforcement (more concrete examples / explicit interaction). Low-ask lessons are often either very clear *or* skipped — cross-reference with `learn_progress_records` to tell which.
