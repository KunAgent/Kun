from __future__ import annotations
from calendar import monthrange
from datetime import datetime
import re
import logging

logger = logging.getLogger(__name__)


def _coerce_invalid_month_end(d):
    """Clamp dates like 20260229 to the last valid day of that month."""
    try:
        if len(d) != 8:
            return None
        year = int(d[:4])
        month = int(d[4:6])
        day = int(d[6:8])
        if year < 1 or month < 1 or month > 12 or day < 1:
            return None
        last_day = monthrange(year, month)[1]
        if day > last_day:
            return f"{year:04d}{month:02d}{last_day:02d}"
    except Exception:
        return None
    return None


def update_date(d):

    logger.info(f"[Tool util call]-[mgmt_update_date]: Found date: {d}. ")

    try:
        d = str(d)
        d = re.sub(r"\D", "", d)
        d = d.lstrip("0")
        if len(d) == 7:
            d = d + "1"
        elif len(d) == 6:
            d = d + "01"
        elif len(d) == 5:
            d = d + "101"
        elif len(d) == 4:
            d = d + "0101"
        try:
            datetime.strptime(d, "%Y%m%d")
        except ValueError:
            coerced = _coerce_invalid_month_end(d)
            if coerced:
                d = coerced
            else:
                raise
    except Exception:
        d = datetime.today().strftime("%Y%m%d")

    logger.info(
        f"[Tool util return]-[dashboard_update_date]: Parsed date: {d}. ")

    return d

def update_input(
    metrics,
    start_date,
    end_date,
    user_input,
    module,
    *,
    allow_future_start_date: bool = False,
    allow_future_end_date: bool = False,
):
    update_list = []
    retry_info_list = []

    # Handle date updates all in one place
    today = datetime.today().strftime("%Y%m%d")

    if not start_date:
        start_date = today
        update_list.append("Start date missing; defaulted to today. ")
    else:
        start_date = update_date(start_date)
        if (not allow_future_start_date) and start_date > today:
            start_date = today
            update_list.append("Start date is in the future; defaulted to today. ")

    if not end_date:
        end_date = today
        update_list.append("End date missing; defaulted to today. ")
    else:
        end_date = update_date(end_date)
        if (not allow_future_end_date) and end_date > today:
            end_date = today
            update_list.append("End date is in the future; defaulted to today. ")

    # TODO：确认产品逻辑，是否需要Swap dates if end_date is earlier than start_date
    if end_date < start_date:
        start_date, end_date = end_date, start_date
        update_list.append("End date is earlier than start date; dates swapped. ")

    if not metrics:
        retry_info_list.append("Metrics are empty. Please retry with valid metrics. ")

    if not module:
        module = "business"
        update_list.append("Module missing; defaulted to business. ")
    elif module not in ["business", "all_studio", "studio", "publishing", "project"]:
        retry_info_list.append("Module not supported; Please retry with valid module. ")

    return update_list, metrics, start_date, end_date, module, retry_info_list


def categorize_metrics_by_granularity_and_chart(metrics, metric_by_code, retry_info_list, module=None, update_list=None):
    """
    Categorize metrics by granularity support and has_chart field.
    Also validates if metrics are supported in the specified module.
    
    Args:
        metrics: List of metric codes to categorize
        metric_by_code: Dictionary mapping metric_code to metric_info
        retry_info_list: List to append error messages to
        module: Module name to validate against (business, all_studio, studio, publishing, project)
        update_list: List to append warning messages to (for module validation failures)
    
    Returns:
        tuple: (monthly_chart_metrics, monthly_no_chart_metrics, yearly_chart_metrics, 
                yearly_no_chart_metrics, unsupported_metrics, all_supported_metrics, retry_info_list)
    """
    logger.info(f"[Tool util call]-[categorize_metrics_by_granularity_and_chart]: Categorizing metrics: {metrics} by metric_by_code: {metric_by_code}, module: {module}. ")
    unsupported_metrics = []
    all_supported_metrics = []
    # Categorize metrics by granularity and has_chart field
    monthly_chart_metrics = []
    monthly_no_chart_metrics = []
    yearly_chart_metrics = []
    yearly_no_chart_metrics = []
    
    if update_list is None:
        update_list = []
    
    if metric_by_code and metrics:
        for metric_code in metrics:
            metric_info = metric_by_code.get(metric_code)
            
            if not metric_info:
                # Metric doesn't exist in the registry
                unsupported_metrics.append(metric_code)
                retry_info_list.append(f"Metric '{metric_code}' is not found in the metric registry. ")
                continue
            
            # Check if metric supports the specified module
            if module:
                metric_modules = metric_info.get("module", [])
                if not isinstance(metric_modules, list):
                    metric_modules = [metric_modules] if metric_modules else []
                
                if module not in metric_modules:
                    # Metric doesn't support this module - remove it and add warning (not error)
                    supported_modules = ", ".join(metric_modules) if metric_modules else "none"
                    update_list.append(f"Metric '{metric_code}' is not supported in module '{module}'. Supported modules: {supported_modules}. This metric has been removed from the query. ")
                    logger.info(f"[Tool util]-[categorize_metrics_by_granularity_and_chart]: Metric '{metric_code}' removed due to unsupported module '{module}'. ")
                    continue
            
            # Check granularity support and categorize metrics
            metric_granularities = metric_info.get("granularity", [])
            if not metric_granularities:
                unsupported_metrics.append(metric_code)
                retry_info_list.append(f"Metric '{metric_code}' has no granularity support defined. ")
                continue
            
            # Get has_chart field (default to False if not present)
            has_chart = metric_info.get("has_chart", False)
            
            # Categorize metrics by granularity support and has_chart
            supports_monthly = "monthly" in metric_granularities
            supports_yearly = "yearly" in metric_granularities
            
            if supports_monthly:
                # Metric only supports monthly
                if has_chart:
                    monthly_chart_metrics.append(metric_code)
                else:
                    monthly_no_chart_metrics.append(metric_code)
                all_supported_metrics.append(metric_code)
            if supports_yearly:
                # Metric only supports yearly
                if has_chart:
                    yearly_chart_metrics.append(metric_code)
                else:
                    yearly_no_chart_metrics.append(metric_code)
                all_supported_metrics.append(metric_code)
            if not supports_monthly and not supports_yearly:
                # Metric doesn't support monthly or yearly
                unsupported_metrics.append(metric_code)
                supported_gran = ", ".join(metric_granularities) if metric_granularities else "none"
                retry_info_list.append(f"Metric '{metric_code}' does not support 'monthly' or 'yearly' granularity. Supported granularities: {supported_gran}. ")
                continue
    elif not metric_by_code:
        # If metric map failed to load, log warning but don't block execution
        logger.warning("Metric map not available, skipping metric validation. ")
    elif not metrics:
        # Already handled in update_input
        pass
    
    return monthly_chart_metrics, monthly_no_chart_metrics, yearly_chart_metrics, yearly_no_chart_metrics, unsupported_metrics, all_supported_metrics, retry_info_list
