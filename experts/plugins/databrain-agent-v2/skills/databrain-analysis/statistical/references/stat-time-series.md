# Time Series (ARIMA)

## Overview

ARIMA for univariate time series forecasting. Use for: DAU trend, revenue trend, Trend Analysis scene.

## When to Use

- Time-ordered data (daily/monthly metrics)
- Forecasting
- Trend sustainability (Mann-Kendall, ADF)

**BI examples:** DAU forecast; Revenue trend

## Code Example

```python
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import adfuller
from statsmodels.graphics.tsaplots import plot_acf, plot_pacf

# Stationarity
adf = adfuller(y_series)
print(f"ADF p-value: {adf[1]:.4f}")
if adf[1] > 0.05:
    y_diff = y_series.diff().dropna()

# Fit ARIMA
model = ARIMA(y_series, order=(1, 1, 1))
results = model.fit()
print(results.summary())

# Forecast
forecast = results.get_forecast(steps=10)
print(forecast.summary_frame())
```
