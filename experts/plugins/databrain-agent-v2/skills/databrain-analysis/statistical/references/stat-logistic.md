# Logistic Regression (Logit, Probit)

## Overview

Logistic regression models binary outcomes (0/1). Use for: conversion, retention yes/no, binary classification with predictors. Implement with statsmodels.

## When to Use

- Binary outcome (converted vs not, churned vs retained)
- Need odds ratios or predicted probabilities

**BI examples:** Conversion ~ channel + creative; Churn ~ engagement + tenure

## Code Example

```python
import statsmodels.api as sm
from statsmodels.discrete.discrete_model import Logit

X = sm.add_constant(X_data)
model = Logit(y_binary, X)
results = model.fit()

print(results.summary())

# Odds ratios
print("Odds ratios:", np.exp(results.params))

# Predicted probabilities
probs = results.predict(X)

# Marginal effects
marginal = results.get_margeff()
print(marginal.summary())
```

## Formula API

```python
import statsmodels.formula.api as smf

results = smf.logit('converted ~ channel + C(segment)', data=df).fit()
```
