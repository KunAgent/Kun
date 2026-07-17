# Regression Diagnostics (VIF, Breusch-Pagan, Residuals)

## Overview

Diagnostics for regression models: heteroskedasticity, autocorrelation, multicollinearity, influence. Use after fitting OLS/GLM.

## When to Use

- After OLS or regression — check residuals
- Anomaly detection, model validation

## Breusch-Pagan (Heteroskedasticity)

```python
from statsmodels.stats.diagnostic import het_breuschpagan

bp = het_breuschpagan(results.resid, exog)
print(f"Breusch-Pagan p-value: {bp[1]:.4f}")  # p<0.05: heteroskedasticity
```

## Durbin-Watson (Autocorrelation)

```python
from statsmodels.stats.stattools import durbin_watson

dw = durbin_watson(results.resid)  # ~2: no autocorrelation
```

## VIF (Multicollinearity)

```python
from statsmodels.stats.outliers_influence import variance_inflation_factor

vif_data = pd.DataFrame({"Variable": X.columns})
vif_data["VIF"] = [variance_inflation_factor(X.values, i) for i in range(X.shape[1])]
# VIF > 10: serious multicollinearity
```

## Cook's Distance (Influence)

```python
influence = results.get_influence()
cooks_d = influence.cooks_distance[0]
# Cook's D > 4/n: influential observation
```

## Robust SE

If heteroskedasticity: use `results.fit(cov_type='HC3')` or `cov_type='HAC'` for time series.
