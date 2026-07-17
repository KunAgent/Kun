# Linear Regression (OLS)

## Overview

Linear regression models a continuous outcome as a linear function of predictors. Use for: engagement vs retention, revenue drivers, continuous Y with continuous/categorical X. Implement with statsmodels.

## When to Use

- Continuous outcome (Y) predicted by one or more X
- Revenue Driver Decomposition, Engagement & Retention (relationship)
- DiD (difference-in-differences) with regression

**BI examples:** Revenue ~ channel + region; Retention ~ engagement + cohort

## Code Example

```python
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
import pandas as pd

# ALWAYS add constant for intercept
X = sm.add_constant(X_data)

model = sm.OLS(y, X)
results = model.fit()
print(results.summary())

# VIF (multicollinearity)
vif = pd.DataFrame()
vif["Variable"] = X.columns
vif["VIF"] = [variance_inflation_factor(X.values, i) for i in range(X.shape[1])]
print(vif)

# Prediction with CI
pred = results.get_prediction(X_new)
print(pred.summary_frame())
```

## Formula API

```python
import statsmodels.formula.api as smf

results = smf.ols('y ~ x1 + x2 + C(category)', data=df).fit()
```

## Diagnostics

Load stat-diagnostics for Breusch-Pagan, VIF, residual plots, Cook's distance.
