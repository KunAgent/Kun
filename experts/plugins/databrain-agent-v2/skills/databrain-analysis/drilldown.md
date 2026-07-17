# Drill-down Analysis (Tabular BI)

**Path:** `/skills/databrain-analysis/drilldown.md`

## Overview

Use for **KPI change explanation**, **drivers**, or **dimensional decomposition** on sandbox data (`pd.read_csv` after `upload_to_sandbox`). Not formal inference—pair with [`statistical/SKILL.md`](statistical/SKILL.md) for tests or CIs.

**React agent**: Load via `read_file` on this path before `execute_sandbox_code`. No `run_skill_script`; Shapley / `v(S)` code lives in sandbox Python (optional `pip install shap`).

**Cumulative joint loop**: Implement in **`execute_sandbox_code`** per **Workflow (`cumulative_joint`)** below (host 有 `cumulative_joint_drilldown_tool`；react 暂无专用工具，勿用 `for d in seq: groupby(d)` 代替联合维度). In `print()` output include columns analogous to **`ATTRIBUTION_TABLE`**: `phi_k`, `attribution_share` (or directional_share), `net_share_vs_parent`, hot flag—summarize 阶段须写入 **归因结论**（见 [`../databrain-summarize/report.md`](../databrain-summarize/report.md)）。

## Attribution (pick one definition and keep it end-to-end)

**Directional (recommended for “who drove the net move”)** — only count segments that pull in the **same direction** as the parent slice’s net change:

- Net **decline** (parent \(\Delta Y < 0\)): use weights \(w_k = \max(0, -\Delta Y_k)\), denominator \(D^- = \sum_k w_k\), share \(w_k / D^-\). Interprets “among downward pulls, who is largest.”
- Net **increase** (parent \(\Delta Y > 0\)): \(w_k = \max(0, \Delta Y_k)\), \(D^+ = \sum_k w_k\), share \(w_k / D^+\).

If \(D^\pm = 0\) (no same-direction segments), stop expanding that branch or fall back to L1 below.

**L1 magnitude** — \(|\Delta Y_k| / \sum_j |\Delta Y_j|\): “share of gross movement” at this slice; sums to 100%; does not target net change narrative.

**Strict additive net** — when child segments **sum to parent** (\(\sum_k \Delta Y_k = \Delta Y\)) at the same grain: \(\Delta Y_k / \Delta Y\) is the net share; components can be negative; magnitudes can exceed 100% when offsets exist—call that out in prose.

**Shapley**

- **Additive decomposition** (single dimension, disjoint buckets, \(\Delta Y = \sum_k \Delta Y_k\)): cooperative game \(v(S) = \sum_{i \in S} \Delta Y_i\) gives Shapley value \(\phi_k = \Delta Y_k\) — **no extra computation**; same as strict additive net. Use directional or L1 on top if you need 0–100% “shares” among pulls.
- **Non-additive** (model \(f\), or interactions): define **coalition value** \(v(S) = f(x_S^{\text{factual}}, x_{-S}^{\text{base}}) - f(x^{\text{base}})\) on factors \(1..n\); then \(\sum_k \phi_k = v(\text{all}) - v(\emptyset)\). **There is no bundled `.py` for this skill**—implement in `execute_sandbox_code`: for small \(n\) average marginal contributions over all permutations; for larger \(n\) use Monte Carlo over random permutations. Tree/GBDT: **`shap`** if you `pip install` it.
- **Do not** confuse Shapley with directional shares: Shapley allocates the **total effect** across factors; directional shares allocate **within same-direction weights**.

**30% rule**: apply to whichever **positive share** you chose (directional \(w_k/D^\pm\), L1 \(|\Delta_k|/\sum|\Delta|\), or \(|\phi_k|/\sum|\phi_j|\) if using Shapley magnitudes). Stay consistent down the tree.

**Analyst output (additive PoP)**: In `print()` tables, include **`phi_k`** (= segment \(\Delta_k\), the Shapley value under additivity), **`directional_share`** (or net \(\phi_k/\Delta Y\)) for the 30% rule, and a **`phi_sum`** check equal to parent \(\Delta Y\) so Shapley is visible even when no extra library runs.

## When to load

- Drill-down / 下钻 / breakdown / decomposition / “which region or channel drove…”
- Contribution, share of total, share of delta, top-N segments
- Multi-level drill-down where a **factor** is used to pick the next branch: “先下钻维度 → 因为某个 factor 贡献高 → 围绕该 factor 再下钻其他维度 → 计算层级贡献和总体贡献”
- Same algorithm as below: `drilldown.dimensions_sequence` + `drilldown.hierarchy_mode` from the scene (`cumulative_joint` default), **30% rule**, until terminal conditions
- Scenes aligned with `scenes.json` drilldown **when the deliverable is segment tables and attribution**, not only a single aggregate test

## Factor-first multi-level drill-down (path-dependent)

Use this mode when the user wants:

- First drill a dimension (e.g. `country`)
- Then, **within one segment**, select the **top factor** (e.g. “price contribution highest”)
- Then drill the **next dimension** under that segment, and at each deeper level still report factor contributions
- And compute both **local (node)** and **global (overall)** contributions for factors

### Data contract (recommended)

This workflow assumes you have a dataframe at a stable grain (row = entity×time or already aggregated) that contains:

- dimension columns \(D\): e.g. `country`, `channel`, `product`, ...
- a KPI effect column (choose one):
  - **Δ-mode**: `delta_y` (period-over-period change) at the same grain you aggregate
  - **Level-mode**: `value_y` (level) at the same grain you aggregate
- per-factor contribution columns (choose one set):
  - **Δ-mode**: `delta_f_<name>` columns that are interpretable contributions to `delta_y` (ideally additive at the analysis grain)
  - **Level-mode**: `part_f_<name>` columns that sum to `value_y` (composition parts)

If factor contribution columns do not exist yet, create them first (domain formula, decomposition, or model-based attribution). This skill then handles the drill-down + reporting logic.

### Local vs global (overall) contribution

At any node slice \(S\) (defined by path filters like `country=="US"`):

- **Local contribution**: aggregate each factor effect within \(S\) (sum of `delta_f_*` or `part_f_*`), then compute share using the same **Directional/L1/Value** logic from **Attribution** above.
- **Global contribution**: map node-local factor contributions back to overall by multiplying a **node weight** \(W(S)\).

Default node weight (stable and explainable):

- **Δ-mode**: baseline exposure share, e.g. `y_base` (base-period KPI) or another baseline scale column:
  \[
  W(S)=\frac{\text{base\_exposure}(S)}{\text{base\_exposure}(\text{all})}
  \]
- **Level-mode**: node share of overall level:
  \[
  W(S)=\frac{V_S(Y)}{V_{all}(Y)}
  \]

Then:

\[
contrib_{global}(F,S)=W(S)\cdot contrib_{local}(F,S)
\]

You must state what column is used as `base_exposure` when using Δ-mode.

### Path-dependent drill procedure (30% rule + factor branching)

Pick a dimension sequence `seq_dims = [D1, D2, D3, ...]` (same as normal drilldown). Then:

1. **Depth 1 (dimension drill)**: drill `D1` on the KPI effect (or `delta_y`) to pick a hot segment `D1=v1` using the same 30% rule (Directional/L1/net as appropriate).
2. **Within the chosen segment node** \(S=\{D1=v1\}\):
   - aggregate factor contributions; compute factor local shares
   - choose focused factor \(F^\*\) (top local share; optionally require ≥ 30%)
3. **Depth 2 (dimension drill under factor focus)**:
   - drill `D2` *within slice \(S\)*, and for each `D2=v2` report:
     - local factor table (top factors + shares)
     - global factor contributions (weighted by \(W(S \cap \{D2=v2\})\))
   - branch selection for the next step uses \(F^\*\) (default): pick the `D2=v2` where **focused factor** has highest global contribution (or highest local share if global weight is not available).
4. Repeat for `D3...` until stop conditions:
   - no factor passes threshold; tiny node weight; max depth; unstable sample size

**Important**: The “focus factor” affects **which child branch you expand**, not how you compute contributions. The contribution math is still the same per-node aggregation + Attribution share definition.

### Joint (联合维度) slices also require attribution

If a level uses **joint keys** (e.g. `country×os`, `country×os×channel`), treat each **joint tuple** as one segment and compute attribution contribution the same way as in `cumulative_joint`:

- **Segment definition**: one row in the grouped table corresponds to a joint cell \(t=(d1=v1,d2=v2,...)\).
- **Attribution contribution**:
  - **Δ-mode**: \(\Delta Y_t\) (or \(\phi_t\) under additive Shapley = \(\Delta Y_t\)) and its share by Directional/L1/net (per the Attribution section).
  - **Factor-first**: within each joint cell \(t\), aggregate factor contributions \(\Delta(F\mid t)\) and compute factor shares; use the same threshold (30%) for “hot” decisions.
- **30% rule**: apply the threshold to **joint cells** (tuple-level attribution share), not to a marginal single dimension at that depth.
- **Local vs global**: local contributions/shares are computed **within the joint cell**; global uses the joint cell’s node weight \(W(t)\) and reports `global_contrib = W(t) * local_contrib`.

### Output requirements (factor-first mode)

At each expanded node, print:

- path filters (e.g. `country=US, channel=FB`)
- node KPI total (Δ or level)
- node weight \(W(S)\)
- top factors: `factor`, `local_contrib`, `local_share`, `global_contrib` (and %)

End with a short **归因结论** summarizing the selected path and top global drivers.

## Stable dimension IDs (vocabulary)

Use these **string tokens** when naming steps or mapping columns (align with scene `drilldown.dimensions_sequence` where applicable):

`time_window`, `time_alignment`, `event_alignment`, `metric_components`, `metric`, `funnel_step`, `topic`, `subtopic`, `region`, `country`, `subregion`, `zone`, `os`, `platform`, `product`, `ua_channel`, `acquisition_channel`, `channel`, `campaign`, `user_segment`, `user_value_segment`, `cohort`, `competitor`, `category`, `subcategory`, `feature`, `content`, `payment_method`, `offer`, `creative_variant`, `placement`, `audience_targeting`, `version`, `language`, `pricing`, `pain_point`, `journey_step`, `failure_type`, `segment_definition`, `early_behavior`, `engagement_segment`, `feature_usage`, `retention_horizon`, `data_pipeline`, `service_ops`, `direction_overlap`, `genre_similarity`, `sentiment_severity`, `eligibility_targeting`, `iegg_total`, `publishing_mode`, `studio`, `game_title`.

**Default drill order** (when no scene / user list): `region` → `country` → `os` → `product` → `ua_channel` → `campaign`. Map `ua_channel` to the acquisition/UA channel column (often `channel` in Dashboard exports).

Map each token to **actual column names** in the dataframe (`print(df.columns.tolist())` first). Skip dimensions that have no column or are constant in the slice.

## Workflow (30% threshold drill-down)

**Contribution** at a level: compute **shares** using the attribution mode from **Attribution** above (directional, L1, net fraction, or Shapley \(\phi_k\) from a defined \(v(S)\)). For **stock** metrics (not change), use **joint** slice value / slice total for cumulative mode. Use the same definition consistently end-to-end.

**Threshold**: default **30%** (`0.30`). Only **hot** segments (see hierarchy modes below) **≥ 30%** expand depth; still print the full table at each depth for audit. Use another cutoff only if the user explicitly asks.

**Dimension order**: Use `drilldown.dimensions_sequence` from the classified scene when available; else an explicit list from the user; else default: `region` → `country` → `os` → `product` → `ua_channel` → `campaign` (then `user_segment` / `cohort` if needed; skip columns missing from `df`). Read `drilldown.hierarchy_mode` from the scene when present.

### Hierarchy modes (scene `drilldown.hierarchy_mode`)

**`cumulative_joint` (default)** — **not** one independent dimension per step. Depth \(k\) uses the **joint** of the first \(k\) dimensions in sequence: level 1 = \(A\), level 2 = \(A\times B\) (groupby `A` + `B` together), level 3 = \(A\times B\times C\), etc. Each **row** of the grouped table is a **tuple** \((a,b,\ldots)\). The 30% rule applies to **joint cells** (tuple-level contribution), not to a marginal B alone.

**Upstream data**: Planner should ask **Dashboard Agent** for **one** joint breakdown (all needed Dashboard dims in the same `group_by` / export), **not** one API call per dimension. Analyst then derives depth-\(k\) tables from that wide table (or a CSV with all dimension columns).

**Procedure (`cumulative_joint`)**:

1. **Inspect** once: `df.shape`, columns, dtypes; map `dimensions_sequence` to column names; reconcile headline total (or Δ) at root.
2. **Root slice**: `df_sub` = filtered `df`; `seq` = ordered column list (length \(m\)).
3. For **depth** \(k = 1, 2, \ldots, m\):
   - `keys = seq[:k]` (joint \(k\) dimensions).
   - `tbl = df_sub.groupby(keys, dropna=False)[metric].sum()` (or PoP delta per tuple—same grain).
   - Compute **contribution** per **joint row** (each tuple is one segment).
   - **Print** the full table for depth \(k\) (label columns as the joint path).
   - **Hot** = joint rows with contribution share ≥ **30%** (per chosen attribution).
   - **Terminal B**: if **no** hot joint row → **stop** (no deeper joint expansion from this slice).
   - If \(k = m\) → **stop** after printing.
   - **Narrow**: `df_sub` = rows of `df_sub` whose `keys` tuple is in **hot** (union of hot tuples if multiple). Then continue to \(k+1\).
4. **Output**: Tables for each depth \(k\) (joint \(A\times\cdots\)); summarize hot tuples and paths. **No charts.**

**Anti-pattern**: `for d in seq: df.groupby(d)` — that repeats **marginal** one-dimension tables only; it is **not** cumulative_joint.

**`nested_single_dim` (legacy)** — **one dimension per step**: at each node group by **only** the next dimension in `remaining_dims`, recurse into hot **categories** on that single dimension (tree path). Use when the scene explicitly sets `hierarchy_mode` to this value.

**Recursive procedure (`nested_single_dim`)** (each branch carries `df_sub` and `remaining_dims`):

1. **Inspect** once globally; reconcile headline at root.
2. **Root**: `df_sub = df` (after filters), `remaining_dims` = ordered list (mapped to columns).
3. **Terminal A**: if `remaining_dims` empty → **stop**.
4. Take `d = remaining_dims[0]`. Group `df_sub` by `d` only; compute contribution per category.
5. **Terminal B**: if **no** category ≥ **30%** → **stop**.
6. For each hot category `v`: `df_next = df_sub[df_sub[d] == v]` (handle NaN); recurse with `df_next`, `remaining_dims[1:]`.
7. **Print** tables at each node; **no charts**.

Optional guardrails: flag tiny joint cells or reconciliation drift when using `cumulative_joint`.

## Workflow (checklist)

1. **Inspect**: `df.shape`, `dtypes`, `df.columns.tolist()`, missing rates for metric and dimension columns.
2. **Define**: Metric column(s), time column (if comparing periods), ordered drill dimensions (scene sequence → user → default), filter scope.
3. **Baseline**: Reproduce headline total or Δ at root; child slices must reconcile to parent where additive; **choose attribution** (directional vs L1 vs net vs Shapley) before computing shares.
4. **Run** the 30% procedure for **`cumulative_joint`** (default) or **`nested_single_dim`** as configured; stop on depth limit or **no hot** joint/category.
5. **Quality**: Call out mixed grain, duplicate keys, or non-additive metrics before over-interpreting.
6. **Follow-up**: If inference is needed on a final slice, `read_file` [`statistical/SKILL.md`](statistical/SKILL.md).

## Pandas patterns (sketch)

**Cumulative joint** (depth k, `keys = [col_a, col_b, ...]` first k dims):

```python
keys = seq[:k]  # mapped to column names
g = df_sub.groupby(keys, dropna=False)[metric].sum()
pct = g / g.sum()  # each joint tuple vs slice total
hot = g[pct >= 0.30]
# narrow: df_sub = df_sub.merge(hot.reset_index()[keys], on=keys, how="inner")  # or isin on MultiIndex
```

**Nested single-dim** (one dimension `d`):

```python
g = df_sub.groupby(d, dropna=False)[metric].sum()
pct = g / g.sum()
hot = g[pct >= 0.30]
```

**Directional shares on `delta`** (after grouping to one row per category):

```python
delta = g  # or period-over-period delta per category, same sign convention as headline
parent_delta = delta.sum()
if parent_delta < 0:
    w = (-delta).clip(lower=0)
elif parent_delta > 0:
    w = delta.clip(lower=0)
else:
    w = delta * 0  # no expansion by direction; or fall back to L1
denom = w.sum()
pct_dir = w / denom if denom > 0 else w * 0
hot = delta[pct_dir >= 0.30]
```

**Period-over-period** at same grain: build `df_sub` with rows per period, pivot or merge to `delta` per entity. Prefer **directional** shares (see **Attribution**) for narrative; use `abs(delta) / abs(delta).sum()` only when you explicitly want L1 gross-movement shares. Reconcile \(\sum \Delta_k\) to parent \(\Delta Y\) before interpreting.

**Shapley in code** — additive: \(\phi_k = \Delta_k\) (no extra routine). Non-additive: implement \(v(S)\) in Python, then Shapley via **all permutations** (small \(n\)) or **random permutations** (MC, large \(n\)); tree models may use **`shap`** after install.

**Recurse** (`nested_single_dim` only): for each hot `v` on `d`, `df_next = df_sub[df_sub[d] == v]`; `remaining_dims[1:]`. For **`cumulative_joint`**, use depth \(k\) loop and **narrow** `df_sub` to hot **tuples** on `keys = seq[:k]` (see Workflow).

Use `dropna=False` when NaN is a meaningful bucket; otherwise filter or document.

## Combining with statistical analysis

- Drill-down **localizes** where the effect is; tests (t-test, ANOVA, regression) **validate** whether differences are statistically convincing.
- After top segments are identified, subset the data and `read_file` [`statistical/SKILL.md`](statistical/SKILL.md) for formal comparison if sample sizes allow.

## Best practices

- **Reconcile**: child-level sums must match parent totals for additive metrics; additive Shapley equals segment \(\Delta_k\)—no double-counting beyond that decomposition.
- **One grain per table**: do not mix daily and weekly rows without resampling.
- **Interpret**: translate table into 2–4 bullet **insights** (what moved, where, how large), not only raw ranks.
- **Idempotent columns**: prefer stable identifiers (codes) over display labels when both exist, unless the question asks for display names.
