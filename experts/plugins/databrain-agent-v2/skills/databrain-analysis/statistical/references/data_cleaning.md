# Data Cleaning (数据清洗)

## Overview

Before running statistical tests, **always** clean and inspect the data. BI data (from Dashboard/Intelligence/Opinion) often has missing values, duplicates, invalid numbers, and column name quirks.

## Workflow

1. **Inspect** columns and dtypes
2. **Handle missing values** (dropna, fillna, or document exclusion)
3. **Remove or handle duplicates**
4. **Validate numeric ranges** (e.g. revenue ≥ 0, retention 0–1)
5. **Check outliers** (optional; report sensitivity)
6. **Then** proceed to statistical tests

---

## 1. Inspect Data

```python
import pandas as pd
import numpy as np

# After loading: df = pd.read_csv('data_xxx.csv')
print(df.columns.tolist())
print(df.dtypes)
print(df.head())
print(df.info())
print(df.isnull().sum())
```

**BI note**: Column names may differ from expectations (e.g. "Region" vs "region"). Use `df.columns.tolist()` to get actual names before filtering.

---

## 2. Missing Values (缺失值)

```python
# Count missing per column
missing = df.isnull().sum()
print(missing[missing > 0])

# Option A: Drop rows with missing in analysis column
df_clean = df.dropna(subset=['revenue', 'channel'])

# Option B: For group comparisons, dropna within each group
g1 = df[df['channel'] == 'A']['revenue'].dropna()
g2 = df[df['channel'] == 'B']['revenue'].dropna()

# Option C: Fill with median (use sparingly; document in report)
df['revenue'] = df['revenue'].fillna(df['revenue'].median())

# Report exclusion
n_before = len(df)
n_after = len(df_clean)
print(f"Excluded {n_before - n_after} rows with missing values ({100*(n_before-n_after)/n_before:.1f}%)")
```

**Recommendation**: Prefer dropna for statistical tests; document exclusions in report.

---

## 3. Duplicates (重复值)

```python
# Check duplicates
dup_count = df.duplicated().sum()
print(f"Duplicate rows: {dup_count}")

# Remove duplicates (keep first)
df_clean = df.drop_duplicates()

# Or drop duplicates by key columns
df_clean = df.drop_duplicates(subset=['date', 'game', 'metric'])
```

---

## 4. Invalid Values (无效值)

```python
# BI: revenue, DAU, downloads should be non-negative
df_clean = df[df['revenue'] >= 0]
df_clean = df_clean[df_clean['retention'].between(0, 1)]  # if retention is 0–1

# Replace invalid with NaN then drop
df['revenue'] = df['revenue'].mask(df['revenue'] < 0, np.nan)
df_clean = df.dropna(subset=['revenue'])
```

---

## 5. Outliers (异常值)

```python
import scipy.stats as stats

# IQR method
q1 = df['revenue'].quantile(0.25)
q3 = df['revenue'].quantile(0.75)
iqr = q3 - q1
lower = q1 - 1.5 * iqr
upper = q3 + 1.5 * iqr
outliers = df[(df['revenue'] < lower) | (df['revenue'] > upper)]
print(f"Outliers (IQR): {len(outliers)} rows")

# Option: winsorize (cap at percentiles) instead of drop
from scipy.stats.mstats import winsorize
df['revenue_winsor'] = winsorize(df['revenue'], limits=[0.02, 0.02])

# Option: report sensitivity (run analysis with and without outliers)
```

**Best practice**: Report how many outliers; run sensitivity analysis if material.

---

## 6. Column Names & Types

```python
# Normalize column names (optional)
df.columns = df.columns.str.strip().str.lower()

# Ensure numeric
df['revenue'] = pd.to_numeric(df['revenue'], errors='coerce')
df['date'] = pd.to_datetime(df['date'], errors='coerce')
```

---

## Complete Pre-Analysis Check (BI)

```python
import pandas as pd
import numpy as np

def clean_for_analysis(df, value_col, group_col=None):
    """Basic cleaning before t-test/ANOVA."""
    df = df.copy()
    # 1. Ensure value is numeric
    df[value_col] = pd.to_numeric(df[value_col], errors='coerce')
    # 2. Drop missing in analysis columns
    cols = [value_col] + ([group_col] if group_col else [])
    df = df.dropna(subset=[c for c in cols if c in df.columns])
    # 3. Remove invalid (e.g. negative revenue)
    if df[value_col].min() < 0:
        df = df[df[value_col] >= 0]
    # 4. Optional: drop duplicates
    df = df.drop_duplicates()
    return df

# Usage
df_clean = clean_for_analysis(df, value_col='revenue', group_col='channel')
g1 = df_clean[df_clean['channel'] == 'A']['revenue']
g2 = df_clean[df_clean['channel'] == 'B']['revenue']
# Then run t-test, ANOVA, etc.
```

---

## Reporting

Document in your output:
- Rows excluded (missing, invalid, duplicates)
- Outlier handling (if any)
- Final sample size per group
