# GLM: Poisson, Negative Binomial (Count Data)

## Overview

Generalized linear models for count outcomes. Use **Poisson** for counts (downloads, events); use **Negative Binomial** when overdispersed (variance > mean).

## When to Use

- Count outcome (downloads, sessions, purchases per user)
- Poisson when mean ≈ variance
- Negative Binomial when overdispersed

**BI examples:** Downloads ~ region + campaign; Sessions ~ engagement

## Code Example

```python
import statsmodels.api as sm

X = sm.add_constant(X_data)

# Poisson
model = sm.GLM(y_counts, X, family=sm.families.Poisson())
results = model.fit()
print(results.summary())
print("Rate ratios:", np.exp(results.params))

# Check overdispersion
overdisp = results.pearson_chi2 / results.df_resid
if overdisp > 1.5:
    from statsmodels.discrete.count_model import NegativeBinomial
    nb = NegativeBinomial(y_counts, X).fit()
    print(nb.summary())
```
