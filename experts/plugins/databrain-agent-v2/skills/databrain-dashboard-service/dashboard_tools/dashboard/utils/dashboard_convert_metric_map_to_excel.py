import pandas as pd
from dashboard_metric_map import DASHBOARD_METRIC_MAP


def map_to_excel(metric_map=None, output_file='dashboard_metric_map.xlsx'):
    """
    Convert a metric map (list of dictionaries) to an Excel file.
    
    Args:
        metric_map: List of dictionaries containing metric information. 
                   If None, uses DASHBOARD_METRIC_MAP from dashboard_metric_map.
        output_file: Path to the output Excel file. Defaults to 'dashboard_metric_map.xlsx'.
    
    Returns:
        str: Path to the created Excel file.
    """
    if metric_map is None:
        metric_map = DASHBOARD_METRIC_MAP
    
    # Convert the list of dictionaries to a DataFrame
    df = pd.DataFrame(metric_map)
    
    # Convert list columns to comma-separated strings for better Excel readability
    list_columns = ['granularity', 'query_names', 'unsupported_aggregation']
    for col in list_columns:
        if col in df.columns:
            df[col] = df[col].apply(lambda x: ', '.join(x) if isinstance(x, list) else x if x is not None else '')
    
    # Save to Excel file
    df.to_excel(output_file, index=False, engine='openpyxl')
    
    print(f"Successfully converted {len(metric_map)} metrics to {output_file}")
    print(f"Columns: {list(df.columns)}")
    
    return output_file


if __name__ == "__main__":
    map_to_excel()

