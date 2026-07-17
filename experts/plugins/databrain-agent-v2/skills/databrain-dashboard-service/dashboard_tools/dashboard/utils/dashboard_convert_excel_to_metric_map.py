import pandas as pd
import json
import math
import os
import io
from collections import defaultdict


def excel_to_map(
    input_excel="metrics.xlsx",
    sheet_name=0,
    output_file=None,
    has_header=True,
    column_names=None
):
    """
    Convert an Excel file to dashboard_metric_map format and write to separate data files.
    
    Creates two output files:
    1. dashboard_metric_map_data.py: Contains DASHBOARD_METRIC_MAP with all metric records
    2. dashboard_metric_map_by_label.py: Contains DASHBOARD_METRIC_MAP_BY_LABEL grouped by label
    
    Args:
        input_excel: Path to the input Excel file. Defaults to 'metrics.xlsx'.
        sheet_name: Sheet index or sheet name. Defaults to 0.
        output_file: Path to the output Python file. If None, writes to dashboard_metric_map_data.py in the same directory.
        has_header: Whether the Excel file has a header row. Defaults to True.
        column_names: List of column names in order. If None, uses default column names.
    
    Returns:
        str: Path to the created Python file (dashboard_metric_map_data.py).
    """
    # Determine output file path
    if output_file is None:
        # Get the directory of this file and write to dashboard_metric_map_data.py in the same directory
        current_dir = os.path.dirname(os.path.abspath(__file__))
        output_file = os.path.join(current_dir, "dashboard_metric_map_data.py")
    # Default column names
    if column_names is None:
        column_names = [
            "metric_code",              # 0
            "metric_code_name",         # 1
            "metric_desc",              # 2
            "metric_type",              # 3
            "value_type",               # 4
            "metric_name_en",           # 5
            "metric_name_cn",           # 6
            "granularity",              # 7  (e.g. "daily, weekly, monthly")
            "unit",                     # 8
            "url",                      # 9
            "label",                    # 10
            "weight",                   # 11
            "active",                   # 12 (0/1)
            "unsupported_aggregation",  # 13 (e.g. "sum, mean, min, max")
        ]
    
    # ==== LOAD EXCEL ====
    if has_header:
        df = pd.read_excel(input_excel, sheet_name=sheet_name)
        # Ensure columns match the expected names (rename if necessary)
        df.columns = column_names[: len(df.columns)]
    else:
        df = pd.read_excel(input_excel, sheet_name=sheet_name, header=None)
        df.columns = column_names[: len(df.columns)]
    
    # ==== HELPER ====
    def is_nan(x):
        return isinstance(x, float) and math.isnan(x)
    
    def split_str_list(x):
        """
        Turn "a, b, c" into ["a", "b", "c"], handle empty/NaN.
        """
        if x is None or is_nan(x):
            return []
        s = str(x).strip()
        if not s:
            return []
        return [part.strip() for part in s.split(",") if part.strip()]
    
    # ==== MAIN CONVERSION ====
    records = []
    
    for _, row in df.iterrows():
        # Skip completely empty rows (no metric_code)
        metric_code = row.get("metric_code")
        if metric_code is None or (isinstance(metric_code, float) and math.isnan(metric_code)):
            continue
        
        item = {
            "metric_code": str(row.get("metric_code", "")).strip(),
            "metric_code_name": str(row.get("metric_code_name", "")).strip(),
            "metric_desc": str(row.get("metric_desc", "")).strip(),
            "metric_type": str(row.get("metric_type", "")).strip(),
            "value_type": str(row.get("value_type", "")).strip(),
            "metric_name_en": str(row.get("metric_name_en", "")).strip(),
            "metric_name_cn": str(row.get("metric_name_cn", "")).strip(),
            "granularity": split_str_list(row.get("granularity")),
            "unit": "" if is_nan(row.get("unit")) else str(row.get("unit", "")).strip(),
            "url": str(row.get("url", "")).strip(),
            "label": str(row.get("label", "")).strip(),
        }
        
        # weight (int)
        weight_val = row.get("weight")
        if not is_nan(weight_val) and weight_val is not None:
            item["weight"] = int(weight_val)
        
        # active (0/1) – only include in JSON if == 1 (matches your example)
        active_val = row.get("active")
        if not is_nan(active_val) and active_val is not None:
            active_int = int(active_val)
            if active_int == 1:
                item["active"] = 1
                
                # unsupported_aggregation – only when active==1
                ua_list = split_str_list(row.get("unsupported_aggregation"))
                item["unsupported_aggregation"] = ua_list
            # if active == 0: omit "active" and "unsupported_aggregation" (like your first two rows)
        
        records.append(item)
    
    # ==== OUTPUT ====
    # Write to separate data file
    new_map_content = "DASHBOARD_METRIC_MAP = "
    buffer = io.StringIO()
    json.dump(records, buffer, ensure_ascii=False, indent=4)
    new_map_content += buffer.getvalue()
    
    # Write to the data file
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(new_map_content)
    
    print(f"Successfully converted {len(records)} metrics and wrote to {output_file}")
    
    # ==== OUTPUT LABEL-GROUPED FORMAT ====
    # Group metrics by label (only include active: 1 metrics)
    label_to_metrics = defaultdict(list)
    
    for record in records:
        # Only include metrics with active == 1
        if record.get("active") == 1:
            label = record.get("label", "").strip()
            metric_code_name = record.get("metric_code_name", "").strip()
            if label and metric_code_name:
                label_to_metrics[label].append(metric_code_name)
    
    # Create the label-grouped format
    label_grouped = [
        {"name": label, "metrics": sorted(set(metrics))}  # Remove duplicates and sort
        for label, metrics in sorted(label_to_metrics.items())
    ]
    
    # Write to separate file for label-grouped format
    label_output_file = os.path.join(
        os.path.dirname(output_file), 
        "dashboard_metric_map_by_label.py"
    )
    
    label_content = "DASHBOARD_METRIC_MAP_BY_LABEL = "
    label_buffer = io.StringIO()
    json.dump(label_grouped, label_buffer, ensure_ascii=False, indent=4)
    label_content += label_buffer.getvalue()
    
    with open(label_output_file, "w", encoding="utf-8") as f:
        f.write(label_content)
    
    print(f"Successfully created label-grouped format with {len(label_grouped)} labels in {label_output_file}")
    
    return output_file


if __name__ == "__main__":
    # ==== CONFIG ====
    INPUT_EXCEL = "Book1.xlsx"      # your excel file name
    SHEET_NAME = 0                    # sheet index or sheet name
    has_header = True
    
    # Write to dashboard_metric_map_data.py (output_file=None uses default)
    excel_to_map(
        input_excel=INPUT_EXCEL,
        sheet_name=SHEET_NAME,
        output_file=None,  # Will write to dashboard_metric_map_data.py in the same directory
        has_header=has_header
    )

