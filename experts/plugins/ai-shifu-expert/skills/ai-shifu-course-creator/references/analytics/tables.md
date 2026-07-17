# Analytics Tables & Codes

The 10 tables you can query, the fields each carries, the code/enum tables to translate raw values, the ID translation rules, and the data traps to be aware of.

## 10 Tables at a Glance

| Table | Answers | Key fields |
|---|---|---|
| `learn_progress_records` | Learner count / completion rate / stuck lesson / recent activity / **lessons completed per learner** | `user_bid`, `outline_item_bid`, `status` (601-608, see code table), `created_at` |
| `learn_generated_blocks` | Content interaction count / likes / type popularity / **interactions per learner** / **follow-up Q&A replay** | `user_bid`, `progress_record_bid`, `outline_item_bid`, `type` (see code table), `role` (1 teacher/AI · 2 learner · 3 UI, **integer**), `status` (1 active / 0 history — **API auto-filters to 1**), `position` (block ordering within a `progress_record_bid`), `liked` (-1/0/1), `generated_content` (raw text, restricted — see `dsl.md`) |
| `learn_lesson_feedbacks` | Lesson ratings / read-vs-listen mode preference / **avg rating per learner** | `user_bid`, `progress_record_bid`, `mode` (read/listen), `score` (1-5) |
| `order_orders` | Enrolments / revenue / channel distribution / refund rate / **total spend per learner** | `user_bid`, `status` (501-505, see code table; **paid** = `502`), `payment_channel` (pingxx/stripe/alipay/wechatpay/…), `paid_price` |
| `var_variable_values` | Learner profile distribution (goals / level / preferences) | `user_bid`, `variable_bid`, `value` (aggregate only — **do not select raw value**; see `privacy-and-presentation.md`) |
| `shifu_user_archives` | Active learner count / archive rate | `user_bid`, `archived` (0 active / 1 archived) |
| `bill_daily_usage_metrics` ⚠️ EMPTY | Was designed to hold pre-aggregated daily credit totals. **Currently 0 rows in production** — the `billing.aggregate_daily_usage_metrics` Celery beat job is not yet registered, so nothing populates this table. **Do not query for credit data via this DSL table; use `shifu-cli.py credit-detail` instead** (server-side bill_usage × credit_ledger_entries join). When the cron is eventually enabled, the previous DSL recipes will work again — until then they always return empty. | `stat_date`, `creator_bid`, `usage_scene` (1201 debug / 1202 preview / 1203 production), `usage_type` (1101 LLM / 1102 TTS), `provider`, `model`, `billing_metric` (7451 LLM input / 7452 LLM cache / 7453 LLM output), `consumed_credits`, `record_count` |
| `user_users` ⚠️ | **Look up nickname by known `user_bid`** / **reverse-look up `user_bid` by phone or email** | `user_bid`, `nickname` (auto PII-redacted), `user_identify` (masked, e.g. `138*****000`); restricted-access rules in `privacy-and-presentation.md` |
| `shifu_published_shifus` 🆕 | **Current published title for one of my courses** / does the same `shifu_bid` have rename history? | `title`, `created_user_bid`, `created_at`, `updated_at`. **Row-lookup only** — aggregate / group_by are rejected; `title` accepts `op=like` with trailing-% (anti-enumeration: ≥ 2 non-wildcard chars); `limit ≤ 50`; owner-only (auto-filtered to `created_user_bid = <you>`) |
| `shifu_draft_shifus` 🆕 | **Current draft (editor) title** — useful when the draft has been renamed but not yet re-published, so the published title still lags | Same fields and restrictions as `shifu_published_shifus` |

The 9 shifu-scoped tables (everything except `user_users`) are automatically constrained to the CLI-supplied `shifu_bid`; all tables except `shifu_user_archives` automatically filter `deleted = 0`. The two `shifu_*_shifus` metadata tables additionally auto-filter `created_user_bid = <caller>` so the row's author must be the caller. `learn_generated_blocks` additionally auto-filters `status = 1` so rerolled history rows do not skew follow-up counts. Do **not** add any of these to your DSL — they are injected.

`user_users` is a **global** user table (no `shifu_bid` column). Its access is heavily restricted — read `privacy-and-presentation.md` before querying.

**Token usage is intentionally not exposed.** Creators can only see *credit* consumption. The canonical real-time path is `shifu-cli.py credit-detail <bid>`, which the backend joins on the fly from `bill_usage` × `credit_ledger_entries` and returns ABS(amount) as `credits` (positive). When the daily aggregation cron is enabled, `bill_daily_usage_metrics.consumed_credits` will become the path for "by-day trend" DSL queries; until then it is empty and `credit-detail` is the only working path.

## Course title is "current published", not "history"

A single `shifu_bid` can carry many rows across the two metadata tables — every save in the editor and every republish leaves an audit trail. Treat them as snapshots, never as the source of "what is the course called now":

- **Current published title (authoritative)** = the row in `shifu_published_shifus` with `deleted = 0` (there is at most one — the API enforces it).
- **Current draft title** = the row in `shifu_draft_shifus` with `deleted = 0`. After a rename in the editor this title leads the published one until the author republishes.
- **Historical / renamed titles** = rows with `deleted = 1` in either table. These are **never** the answer to "this course is currently called …". If a user mentions a title from memory and only the historical rows match, tell them so explicitly — do not silently report a historical title as the current one.

PDF §0 + §7 of the 2026-05-15 query handbook describes the failure mode this rule prevents: the same `shifu_bid` was incorrectly reported as `跟 AI 学 AI 通识` because that title appeared in its history, even though the row with `deleted = 0` had since been renamed to `李卓:K12 AI 教育产品的一线实践`. Always anchor the title from the `deleted = 0` row of the published table; fall back to the draft only when published has no matching row.

## `learn_generated_blocks` type codes

`type` (integer):

| type | Name | Source | `generated_content` selectable? |
|---|---|---|---|
| `301` | `content` — system narration | Course template | yes |
| `311` | `mdcontent` — Markdown narration | Course template | yes |
| `312` | `mdinteraction` — interaction prompt | Course template | yes |
| `321` | `mdask` — **learner follow-up question** | Learner input | yes |
| `322` | `mdanswer` — **LLM answer to follow-up** | LLM generated | yes |
| `303` input / `304` options / `309` phone / `310` checkcode etc. | Learner input widgets | Learner input | no — blocked at protocol level |

`role` (integer): `1` = teacher / AI (`assistant`) · `2` = learner (`user`) · `3` = UI widget

> **Trap — `role = 2` is not only follow-up questions.** The learner-input role is shared by input widgets (`type = 303` input, `type = 309` phone, `type = 310` checkcode, etc.). To count *follow-up* questions specifically, filter `type = 321` — do **not** key off `role = 2` alone. (PDF §6 trap #1.)

`status` (integer): `1` = current live row · `0` = superseded by a reroll. The API auto-injects `status = 1`, so a follow-up count reflects what the learner actually sees, not earlier rerolls. The DSL still accepts `status` in `filter` / `group_by` for debugging — but adding `status = 1` explicitly is redundant.

`position` (integer): index of this block within the lesson's `progress_record_bid`. Used as the deterministic ordering key for follow-up Q&A pairing — see "Follow-up Q&A four-key pairing" below.

`liked` (integer): `-1` thumbs down · `0` no reaction · `1` thumbs up

## Follow-up Q&A four-key pairing

The 2026-05-15 query handbook PDF §6 recommends pairing a `type = 321` learner question to its `type = 322` LLM answer by `(progress_record_bid, shifu_bid, outline_item_bid, position)` rather than time order alone:

- `shifu_bid` is already constant per query (CLI scope).
- `progress_record_bid` pins the conversation thread for one learner-lesson session.
- `outline_item_bid` distinguishes simultaneous threads if the learner is in multiple lessons.
- `position` is the within-thread ordering — the question's `position`, plus the next `position` value for the answer.

`created_at` time-ordering still works as a fallback when `position` is missing or two blocks share a position (rare but possible during concurrent generation). Recipe 22 in `recipes.md` shows the canonical 3-step pairing.

## `learn_progress_records.status`

| Code | Chinese | English |
|---|---|---|
| `601` | 未开始 | Not started |
| `602` | 进行中 | In progress |
| `603` | 已完成 | Completed |
| `604` | 已退款 | Refunded |
| `605` | 已锁定 | Locked |
| `606` | 不可用 | Unavailable |
| `607` | 分支跳过 | Branch-skipped |
| `608` | 已重置 | Reset |

Completion rate counts `status = 603` only. "Participating learners" = `status >= 602`.

**Denominator options for completion rate (state which you used):**

- Method ① `count_distinct(user_bid)` in `learn_progress_records` — learners who entered the course (most common; answers "of those who started, how many finished")
- Method ② `order_orders status = 502` purchaser count — answers "of those who bought, how many finished" (requires two queries and agent-side division)

## `order_orders.status`

| Code | Chinese | English |
|---|---|---|
| `501` | 已创建未付款 | Created, unpaid |
| `502` | 已付款 ✅ | Paid |
| `503` | 已退款 | Refunded |
| `504` | 待支付 | Pending payment |
| `505` | 已超时 | Timed out |

**Match the filter to the user's intent:**

| User asks | Correct filter | Notes |
|---|---|---|
| "How many people paid" | `status = 502, paid_price > 0` | Strict paid, excludes ¥0 orders |
| "Free enrolments / ¥0 purchases" | `status = 502, paid_price = 0` | Paid but ¥0 |
| "All paid orders (incl. ¥0)" | `status = 502` | No price filter |
| "How many placed an order" | `status in (501, 502, 504)` | Unpaid + paid + pending |
| "How many refunds" | `status = 503` | Refunded only |
| "Full order funnel" | No status filter; `group_by status` | See distribution |

**Common mistake**: `status >= 502` includes refunded (503), pending (504), timed-out (505), inflating revenue. Use `=` or `in` — never `>=`.

## `order_orders.payment_channel`

| Value | Meaning |
|---|---|
| `pingxx` | Ping++ aggregated channel (WeChat Pay / Alipay etc.) |
| `stripe` | Stripe (international credit cards) |
| `alipay` | Alipay native |
| `wechatpay` | WeChat Pay native |
| `open_api` | Orders created via OpenAPI (not learner-initiated payments) |
| `""` (empty) | Legacy data or manually imported activity orders |

## `learn_lesson_feedbacks.mode`

| Value | Meaning |
|---|---|
| `"read"` | Reading mode (text lesson) |
| `"listen"` | Listening mode (audio) |

## `learn_lesson_feedbacks.score`

1-5 stars. Display as ⭐ or "X stars".

## `bill_daily_usage_metrics.usage_type`

| Code | Meaning |
|---|---|
| `1101` | LLM inference call |
| `1102` | TTS speech synthesis |

> **Common misclassification**: `usage_type = 1102` (TTS) has nothing to do with learner follow-up questions.
> Follow-ups trigger LLM calls (`usage_type = 1101`); TTS is for AI-narrated audio (triggered when learners switch to listen mode). They are independent paths.
> To measure follow-up question volume, query `learn_generated_blocks(type = 321)`.

## `bill_daily_usage_metrics.usage_scene`

| Code | Meaning | Notes |
|---|---|---|
| `1201` | Debug | Author debugging in editor (rare) |
| `1202` | Preview | Author / shared teacher / admin previewing course |
| `1203` | Learner production | **Real learner learning** |

> Always add `where usage_scene = 1203` when measuring real learner-driven credit consumption. Omitting it mixes preview activity (author / co-author / admin) into the total.

## `bill_daily_usage_metrics.billing_metric`

| Code | Meaning |
|---|---|
| `7451` | LLM input tokens |
| `7452` | LLM cache-hit tokens (typically priced lower) |
| `7453` | LLM output tokens |

> `billing_metric` lets you split a model's credit consumption into input vs cache vs output. Sum across all three values for a single model's total credits.

## `shifu_user_archives.archived`

| Code | Meaning |
|---|---|
| `0` | Active / enrolled |
| `1` | Archived (learner removed from bookshelf) |

## ID Field Translation Rules

All `*_bid` values are 36-char pseudo-IDs. Never display them raw. Translate as follows:

| Field | How to translate |
|---|---|
| `shifu_bid` | Use the `shifu-cli.py list` cache: `bid → name` |
| `outline_item_bid` | Use the `shifu-cli.py show <shifu_bid>` cache: recurse the outline tree to map `bid → name`; render as "Lesson X.Y: \<title\>" |
| `progress_record_bid` | Two-step: ① DSL query `learn_progress_records` with `where progress_record_bid in […]` + `select progress_record_bid, outline_item_bid` to get the mapping; ② translate `outline_item_bid` via the outline cache |
| `user_bid` | **Never show raw**. Use ordinal labels ("Learner A / B / C" or "Top 1 / Top 2"). If the user wants to know who, batch the user_bids (deduped, ≤ 50) into a `user_users` query per `privacy-and-presentation.md` and append the nickname: `Learner A (Python 学徒)` |
| `variable_bid` | No name-lookup API exists; `group_by variable_bid count_distinct user_bid` to show the distribution, then tell the user the values — **do not display the raw variable_bid** |
| `order_bid` / `lesson_feedback_bid` / `generated_block_bid` / `daily_usage_metric_bid` | Row-level primary keys — **never display**; used internally for deduplication / counting only |

**Absolute rule**: never paste a `bid` string verbatim in user-facing output (unless the user explicitly requests raw IDs for debugging).

## Data Trap — Duplicate rows in `learn_progress_records`

A learner can have multiple progress records for the **same lesson** (`outline_item_bid`) — e.g. after resetting and re-learning, the old record is kept and a new one is created. The endpoint auto-filters `deleted = 0` but does **not** deduplicate.

**Safe usage (count learners — recommended):**

- `count_distinct(user_bid)` + `where status = 603` → deduplication is implicit
- `count_distinct(user_bid)` group_by `outline_item_bid` → learners stuck per lesson

**Risky usage (count occurrences — use with caution):**

- `count(progress_record_bid)` + `where status = 603` → may exceed true learner count
- "lessons completed per learner" can double-count a lesson the learner re-took

**DSL limitation**: window functions are not supported, so selecting the latest record per learner per lesson is not possible. If the user needs precise "final state per learner per lesson", explain the limitation and substitute with `count_distinct(user_bid)`.

## Three Independent "Amounts" — Never Mix

| Amount type | Source | Who pays | How to query |
|---|---|---|---|
| **Course price / revenue** | `order_orders.paid_price` | Learner pays the creator | DSL `order_orders` |
| **Model call credit consumption** | `credit_ledger_entries.amount` (joined with `bill_usage` server-side) | Creator's credits are deducted | `shifu-cli.py credit-detail <bid>` (`bill_daily_usage_metrics` is currently empty pending cron registration) |
| **Plan / credit pack purchases** | Internal billing tables | Creator recharges credits | not queryable |

If the user asks "how much revenue did my course earn" → DSL `order_orders`. If the user asks "how many credits did I spend / what did it cost" → `shifu-cli.py credit-detail`. **These are completely different — do not mix them.**

The `credit-detail` endpoint returns the absolute credit amount (`ABS(credit_ledger_entries.amount)`) already in account-currency units; no further conversion needed. Do not try to re-derive credits from token counts — token data is not part of the creator surface.

## Tables That Do NOT Exist (common wrong guesses)

When in doubt, do not guess — only the 10 tables above are valid. These table names do **not** exist and will trigger `11003` (table not in whitelist):

| Wrong guess | Why it fails | Use instead |
|---|---|---|
| `user_logs` | Does not exist | `learn_generated_blocks` for interaction data, `learn_progress_records` for progress |
| `logs` / `event_logs` | Does not exist | Same as above |
| `billing` / `usage` | Does not exist | `bill_daily_usage_metrics` (currently empty) or `shifu-cli.py credit-detail` |
| `credits` / `credit_logs` | Does not exist | `shifu-cli.py credit-detail <bid>` |
| `users` | Wrong name (it's `user_users`) | `user_users` |
| `lessons` / `courses` | Does not exist | `shifu_published_shifus` / `shifu_draft_shifus` for metadata, `learn_progress_records` for learner data |

**Rule**: if a table name is not in the "10 Tables at a Glance" table above, it does not exist. Do not try it — you will get `11003`.
