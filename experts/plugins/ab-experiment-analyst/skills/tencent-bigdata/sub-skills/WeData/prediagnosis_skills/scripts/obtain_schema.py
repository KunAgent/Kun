import json
import requests
from argparse import ArgumentParser
from typing import Dict, List, Optional
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from tdw_tauth_authentication import TdwTauthAuthentication

# Default API base URL (for SQL parse and precompile)
DEFAULT_API_BASE = "http://21.72.237.104"

# WeData OpenAPI endpoints for metadata
WEDATA_OPENAPI_BASE = "http://openapi.wedata.woa.com"
API_DESCRIBE_DATABASE_TABLES = f"{WEDATA_OPENAPI_BASE}/meta/v3/datamap/DescribeDatabaseTables"
API_DESCRIBE_TABLE_DETAIL = f"{WEDATA_OPENAPI_BASE}/meta/v3/DescribeTableDetail"
API_DESCRIBE_ASSET_PARTITIONS = f"{WEDATA_OPENAPI_BASE}/datamap/DescribeAssetPartitions"

# Default credentials for WeData OpenAPI
DEFAULT_API_USERNAME = "wedata_sql_copilot"
DEFAULT_API_KEY = "ZDJmMjQ3YzY0NmUxMzM3ZmYzMzEwYjAxZWVmYjQ1Y2IyNzBlNDQ1N2EwZDhkN2Jj"
DEFAULT_SERVICE_NAME = "wedata_openapi"

DEFAULT_HEADERS = {
    "Content-Type": "application/json",
}


def precompile_sql(
    sql: str,
    database: Optional[str] = None,
    UserName: Optional[str] = None,
    cluster: Optional[str] = None,
    api_base: Optional[str] = None,
) -> Dict:
    api_base = api_base or DEFAULT_API_BASE
    url = f"{api_base}/api/v1/tools/sql/precompile"
    payload = {"sql": sql}
    if database:
        payload["database"] = database
    if UserName:
        payload["UserName"] = UserName
    if cluster:
        payload["cluster"] = cluster

    response = requests.post(url, headers=DEFAULT_HEADERS, json=payload, timeout=60)
    response.raise_for_status()
    result = response.json()
    if str(result.get("code")) == "0":
        return result.get("data", {})
    return {"success": False, "errors": [{"message": result.get("message", "Unknown error")}]}


def _get_auth_headers(
    api_username: str = DEFAULT_API_USERNAME,
    api_key: str = DEFAULT_API_KEY,
    service_name: str = DEFAULT_SERVICE_NAME,
    proxy_user: Optional[str] = None,
) -> Dict:
    """
    Build authenticated headers for WeData OpenAPI calls using TAuth.
    """
    tdwTA = TdwTauthAuthentication(
        userName=api_username,
        cmk=api_key,
        target=service_name,
        proxyUser=proxy_user,
    )
    authentication = tdwTA.getAuthentication()
    return {
        "Content-Type": "application/json",
        "secure-authentication": authentication.get("secure-authentication", ""),
    }


def get_table_columns(
    db_name: str,
    table_name: str,
    cluster: str = "tl",
    api_username: str = DEFAULT_API_USERNAME,
    api_key: str = DEFAULT_API_KEY,
    service_name: str = DEFAULT_SERVICE_NAME,
    proxy_user: Optional[str] = None,
) -> List[Dict]:
    """
    Fetch column information for a table using DescribeDatabaseTables API.

    Returns a list of column dicts with keys:
      - ColumnName, ColumnType, Description, IsPartition, Order
    """
    headers = _get_auth_headers(api_username, api_key, service_name, proxy_user)
    filters = [
        {"Name": "ClusterNames", "Values": [cluster], "ExactFlag": True},
        {"Name": "TableNames", "Values": [table_name], "ExactFlag": True},
    ]
    if db_name:
        filters.append({"Name": "DatabaseNames", "Values": [db_name], "ExactFlag": True})

    payload = {
        "MetaType": "column",
        "PageSize": 200,
        "PageNumber": 1,
        "AndFilters": filters,
    }

    try:
        response = requests.post(
            API_DESCRIBE_DATABASE_TABLES, headers=headers, json=payload, timeout=60
        )
        response.raise_for_status()
        result = response.json()
        rows = result.get("Response", {}).get("Data", {}).get("Rows", [])
        # Sort by column order if available
        if rows and rows[0].get("ColumnDetailVo", {}).get("Order") is not None:
            rows.sort(key=lambda x: x.get("ColumnDetailVo", {}).get("Order", 0))
        return rows
    except Exception as e:
        print(f"    - Error calling DescribeDatabaseTables API: {e}")
        return []


def get_table_detail(
    db_name: str,
    table_name: str,
    cluster: str = "tl",
    api_username: str = DEFAULT_API_USERNAME,
    api_key: str = DEFAULT_API_KEY,
    service_name: str = DEFAULT_SERVICE_NAME,
    proxy_user: Optional[str] = None,
) -> Dict:
    """
    Fetch table detail (description, columns with partition info, storage size)
    using DescribeTableDetail API.

    Returns the Data dict from the API response, which includes:
      - Description: table description
      - Columns: list of {ColumnName, ColumnType, Remarks, IsPartition, ...}
      - StorageSize: total storage size in bytes
      - etc.
    """
    headers = _get_auth_headers(api_username, api_key, service_name, proxy_user)
    payload = {
        "ClusterName": cluster,
        "DatabaseName": db_name,
        "TableName": table_name,
    }

    try:
        response = requests.post(
            API_DESCRIBE_TABLE_DETAIL, headers=headers, json=payload, timeout=60
        )
        response.raise_for_status()
        result = response.json()
        resp = result.get("Response", {})
        code = resp.get("Code", "")
        if code and code.startswith("IgnoreError"):
            print(f"    - DescribeTableDetail returned: {code}")
            return {}
        return resp.get("Data", {})
    except Exception as e:
        print(f"    - Error calling DescribeTableDetail API: {e}")
        return {}


def get_asset_partitions(
    db_name: str,
    table_name: str,
    cluster: str = "tl",
    api_username: str = DEFAULT_API_USERNAME,
    api_key: str = DEFAULT_API_KEY,
    service_name: str = DEFAULT_SERVICE_NAME,
    proxy_user: Optional[str] = None,
) -> Dict:
    """
    Fetch partition information for a table using DescribeAssetPartitions API.

    Returns a dict with partition statistics:
      - TotalCount: total number of partitions
      - Partitions: list of partition entries with Name, Size, RowCount, etc.
    """
    headers = _get_auth_headers(api_username, api_key, service_name, proxy_user)
    payload = {
        "ClusterName": cluster,
        "DatabaseName": db_name,
        "TableName": table_name,
        "PageSize": 10,
        "PageNumber": 1,
    }

    try:
        response = requests.post(
            API_DESCRIBE_ASSET_PARTITIONS, headers=headers, json=payload, timeout=60
        )
        response.raise_for_status()
        result = response.json()
        resp = result.get("Response", {})
        return resp.get("Data", {})
    except Exception as e:
        print(f"    - Error calling DescribeAssetPartitions API: {e}")
        return {}


def get_metadata(
    db_table_names: List[str],
    cluster: str = "tl",
    proxy_user: Optional[str] = None,
    api_username: str = DEFAULT_API_USERNAME,
    api_key: str = DEFAULT_API_KEY,
    service_name: str = DEFAULT_SERVICE_NAME,
) -> Dict:
    """
    Fetch table metadata using WeData OpenAPI endpoints.

    For each table, calls:
      1. DescribeDatabaseTables (MetaType=column) - column info with partition flags
      2. DescribeTableDetail - table description and storage size
      3. DescribeAssetPartitions - partition count and sizes

    Returns a dict keyed by "db.table" with combined metadata for each table.
    """
    if not db_table_names:
        return {}

    metadata = {}  # type: Dict[str, Dict]

    def _fetch_single_table(db_table: str) -> tuple:
        """Fetch metadata for a single table. Returns (key, metadata_dict)."""
        if "." in db_table:
            db_name, tbl_name = db_table.split(".", 1)
        else:
            db_name, tbl_name = "", db_table

        auth_kwargs = {
            "cluster": cluster,
            "api_username": api_username,
            "api_key": api_key,
            "service_name": service_name,
            "proxy_user": proxy_user,
        }

        # 1. Get column info from DescribeDatabaseTables
        columns_data = get_table_columns(db_name, tbl_name, **auth_kwargs)

        # 2. Get table detail from DescribeTableDetail
        detail_data = get_table_detail(db_name, tbl_name, **auth_kwargs)

        # 3. Get partition info from DescribeAssetPartitions
        partition_data = get_asset_partitions(db_name, tbl_name, **auth_kwargs)

        return db_table, {
            "columns_data": columns_data,
            "detail_data": detail_data,
            "partition_data": partition_data,
        }

    # Fetch metadata for all tables concurrently
    with ThreadPoolExecutor(max_workers=min(len(db_table_names), 5)) as executor:
        futures = {executor.submit(_fetch_single_table, name): name for name in db_table_names}
        for future in as_completed(futures):
            try:
                key, meta = future.result()
                metadata[key] = meta
            except Exception as e:
                table_name = futures[future]
                print(f"    - Error fetching metadata for {table_name}: {e}")
                metadata[table_name] = {
                    "columns_data": [],
                    "detail_data": {},
                    "partition_data": {},
                }

    return metadata


def format_compilation(precompile_result: Dict) -> List[str]:
    """
    Format compilation result to a list of error/warning message strings.
    Returns an empty list if compilation succeeded with no errors.
    """
    success = precompile_result.get("success", True)
    errors = precompile_result.get("errors", [])
    warnings = precompile_result.get("warnings", [])

    if success and not errors:
        return []

    parts = []
    for err in errors:
        msg = err.get("message", "")
        code = err.get("code", "")
        line = err.get("line")
        column = err.get("column")
        near = err.get("near")

        error_str = msg
        if code:
            error_str = f"[{code}] {msg}"
        if line and column:
            error_str += f" (line {line}, column {column})"
        if near:
            error_str += f", near '{near}'"
        parts.append(error_str)

    for warn in warnings:
        msg = warn.get("message", "")
        code = warn.get("code", "")
        warn_str = f"[WARNING] {msg}" if code else msg
        parts.append(warn_str)

    return parts


def _parse_table_names_arg(table_names_str: str) -> List[List[str]]:
    """
    Parse the --table_names argument string into a list of table name lists.

    Format: multiple SQLs separated by ';', multiple tables within one SQL
    separated by ','.
    Example: "db1.tableA,db1.tableB;db2.tableC" -> [["db1.tableA", "db1.tableB"], ["db2.tableC"]]
    """
    result = []
    for group in table_names_str.split(";"):
        group = group.strip()
        if group:
            tables = [t.strip() for t in group.split(",") if t.strip()]
            result.append(tables)
        else:
            result.append([])
    return result


def _build_table_info_from_names(
    table_names: List[str],
    metadata_result: Dict,
) -> List[Dict]:
    """
    Build table info from externally provided table names + WeData OpenAPI metadata.
    This replaces build_table_info() when SQL parse is skipped.

    Args:
        table_names: List of fully qualified table names (dbName.tableName).
        metadata_result: Dict keyed by "db.table" with combined metadata.

    Returns:
        List of table info dicts matching format_of_API_return.md specification.
    """
    tables_info = []
    seen = set()

    for full_name in table_names:
        if full_name in seen:
            continue
        seen.add(full_name)

        # Look up metadata
        meta = metadata_result.get(full_name, {})
        columns_data = meta.get("columns_data", [])
        detail_data = meta.get("detail_data", {})
        partition_data = meta.get("partition_data", {})

        # Build columns list
        columns = []
        partition_columns = []

        if columns_data:
            for idx, row in enumerate(columns_data):
                col_detail = row.get("ColumnDetailVo", {}) or {}
                is_partition = bool(col_detail.get("IsPartition", False))
                col_entry = {
                    "index": col_detail.get("Order", idx + 1),
                    "name": row.get("ColumnName", ""),
                    "type": (row.get("ColumnType", "STRING") or "STRING").upper(),
                    "comment": row.get("Description", "") or "",
                    "partition": is_partition,
                }
                columns.append(col_entry)
                if is_partition:
                    partition_columns.append(col_entry.copy())
        elif detail_data.get("Columns"):
            for idx, col in enumerate(detail_data.get("Columns", [])):
                is_partition = bool(col.get("IsPartition", False))
                col_entry = {
                    "index": idx + 1,
                    "name": col.get("ColumnName", ""),
                    "type": (col.get("ColumnType", "STRING") or "STRING").upper(),
                    "comment": col.get("Remarks", "") or "",
                    "partition": is_partition,
                }
                columns.append(col_entry)
                if is_partition:
                    partition_columns.append(col_entry.copy())

        description = detail_data.get("Description", "") or ""
        total_size = detail_data.get("StorageSize", None)
        total_rows = detail_data.get("RowCount", None)

        partition_num = partition_data.get("TotalCount", None)
        partition_size = None
        partition_rows = None
        partitions_list = partition_data.get("Partitions", [])
        if partitions_list:
            sizes = [p.get("Size", 0) or 0 for p in partitions_list if p.get("Size") is not None]
            if sizes:
                partition_size = sum(sizes) // len(sizes)
            row_counts = [p.get("RowCount", 0) or 0 for p in partitions_list if p.get("RowCount") is not None]
            if row_counts:
                partition_rows = sum(row_counts) // len(row_counts)

        table_entry = {
            "tableName": full_name,
            "description": description,
            "columns": columns,
            "partitionColumns": partition_columns,
            "totalRows": total_rows,
            "totalSize": total_size,
            "partitionSize": partition_size,
            "partitionRows": partition_rows,
            "partitionNum": partition_num,
            "tempTable": False,
            "relationships": "",
        }

        tables_info.append(table_entry)

    return tables_info


def get_sql_data_with_table_names(
    sql_list: List[str],
    table_names_per_sql: List[List[str]],
    cluster: Optional[str] = None,
    UserName: Optional[str] = None,
    database: Optional[str] = None,
    api_base: Optional[str] = None,
    api_username: str = DEFAULT_API_USERNAME,
    api_key: str = DEFAULT_API_KEY,
    service_name: str = DEFAULT_SERVICE_NAME,
) -> List[Dict]:
    """
    Process SQL list using externally provided table names instead of SQL parse API.

    This function skips the SQL parse step and directly uses the table names
    provided by the caller (e.g., extracted by LLM) to fetch metadata via
    WeData OpenAPI. Precompile is still called for compilation error detection.

    Args:
        sql_list: List of SQL query strings.
        table_names_per_sql: List of table name lists, one per SQL.
            Each table name should be in "dbName.tableName" format.
        cluster: TDW cluster name.
        UserName: TDW proxy user.
        database: Default database name for precompile.
        api_base: Base URL for precompile API.
        api_username: WeData OpenAPI auth username.
        api_key: WeData OpenAPI auth key.
        service_name: WeData OpenAPI service name.

    Returns:
        List of structured dicts with SQL details, table info, and compilation results.
    """
    api_base = api_base or DEFAULT_API_BASE
    results = []

    # Collect all unique table names across all SQLs for batch metadata fetching
    all_table_names = set()
    for names in table_names_per_sql:
        all_table_names.update(names)
    all_table_names = list(all_table_names)

    # Fetch metadata for all tables at once
    metadata_result = {}
    if all_table_names and cluster:
        print(f"  Fetching metadata for {len(all_table_names)} unique table(s) via WeData OpenAPI...")
        metadata_result = get_metadata(
            all_table_names,
            cluster=cluster,
            proxy_user=UserName,
            api_username=api_username,
            api_key=api_key,
            service_name=service_name,
        )
    else:
        if not all_table_names:
            print(f"  No table names provided, skipping metadata API")
        else:
            print(f"  Skipping metadata API (cluster not provided)")

    for i, sql in enumerate(sql_list):
        print(f"  Processing SQL {i + 1}: {sql[:80]}...")

        # Get table names for this SQL
        current_table_names = table_names_per_sql[i] if i < len(table_names_per_sql) else []
        print(f"    - Using {len(current_table_names)} externally provided table name(s): {current_table_names}")

        # SQL预编译 - get compilation errors (still useful without SQL parse)
        print(f"    - Calling SQL预编译 API...")
        try:
            precompile_result = precompile_sql(
                sql,
                database=database,
                UserName=UserName,
                cluster=cluster,
                api_base=api_base,
            )
        except Exception as e:
            print(f"    - Error calling SQL预编译 API: {e}")
            precompile_result = {"success": False, "errors": [{"message": str(e)}]}

        # Build table info from externally provided names + metadata
        table_info = _build_table_info_from_names(current_table_names, metadata_result)
        print(f"    - Table info: {len(table_info)} table(s) in result")

        entry = {
            "sql": sql,
            "business_requirement": "",
            "compilation": format_compilation(precompile_result),
            "table": table_info,
            "udf": [],
            "operators": [],
            "fieldCount": 0,
        }

        results.append(entry)

    return results


def build_sliced_sql_details(
    sql_list: List[str],
    api_data: List[Dict],
    business_requirements: Optional[List[str]] = None,
) -> List[Dict]:
    """
    Assemble sliced_sql_details from raw SQL queries and API response data.

    Each element in the result contains:
      - sql: The original SQL query string
      - table: List of table schema dicts (from API or pre-loaded)
      - business_requirement: Optional business requirement text
      - compilation: Compilation result/error message (if any)
      - operators: Query operators (JOIN, GROUP BY, etc.)
      - udf: User-defined functions
      - fieldCount: Number of fields in SELECT

    Args:
        sql_list: Original SQL query strings.
        api_data: Response data from the compilation API, one entry per SQL.
        business_requirements: Optional list of business requirement strings,
                               aligned with sql_list by index.

    Returns:
        List of structured dicts ready for organize_sql_info.py processing.
    """
    sliced_sql_details = []
    for i, sql in enumerate(sql_list):
        detail = api_data[i] if i < len(api_data) else {}
        entry = {
            "sql": sql,
            "business_requirement": "",
            "compilation": detail.get("compilation", []),
            "table": detail.get("table", []),
            "udf": detail.get("udf", []),
            "operators": detail.get("operators", []),
        }
        # Carry over fieldCount if present
        if "fieldCount" in detail:
            entry["fieldCount"] = detail["fieldCount"]
        # Attach business requirement if provided
        if business_requirements and i < len(business_requirements):
            br = business_requirements[i]
            if br:
                entry["business_requirement"] = br
        sliced_sql_details.append(entry)
    return sliced_sql_details


if __name__ == "__main__":
    parser = ArgumentParser(
        description=(
            "Call the SQL预编译 API and WeData OpenAPI "
            "(DescribeDatabaseTables, DescribeTableDetail, DescribeAssetPartitions) "
            "to obtain table schemas, compilation results, and assemble structured "
            "sliced_sql_details for downstream processing. "
            "Table names are provided externally via --table_names (e.g., extracted by LLM)."
        )
    )
    parser.add_argument(
        "--input_path", type=str, required=True,
        help=(
            "Path to a JSON file containing the input data. "
            "Expected format: "
            '{"sql_list": ["SELECT ...", ...], '
            '"business_requirements": ["requirement1", ...], '
            '"supplement_knowledge": ["knowledge1", ...]}'
        ),
    )
    parser.add_argument(
        "--output_path", type=str, required=True,
        help="Path to write the output JSON file with assembled sliced_sql_details.",
    )
    parser.add_argument(
        "--api_base", type=str, default=DEFAULT_API_BASE,
        help="Base URL for the SQL precompile API server (default: http://21.72.237.104).",
    )
    parser.add_argument(
        "--cluster", type=str, default="tl",
        help="TDW cluster name for metadata API (e.g., tl).",
    )
    parser.add_argument(
        "--user_name", type=str, default="ericggzhang",
        help="TDW proxy user for metadata and precompile API.",
    )
    parser.add_argument(
        "--database", type=str, default="teg_tdbank",
        help="Default database name for precompile API.",
    )
    parser.add_argument(
        "--api_username", type=str, default=DEFAULT_API_USERNAME,
        help="WeData OpenAPI authentication username.",
    )
    parser.add_argument(
        "--api_key", type=str, default=DEFAULT_API_KEY,
        help="WeData OpenAPI authentication key (CMK).",
    )
    parser.add_argument(
        "--service_name", type=str, default=DEFAULT_SERVICE_NAME,
        help="WeData OpenAPI service name for TAuth.",
    )
    parser.add_argument(
        "--table_names", type=str, required=True,
        help=(
            "Externally provided table names (e.g., extracted by LLM). "
            "Format: multiple SQLs separated by ';', multiple tables within "
            "one SQL separated by ','. Each table must be in 'dbName.tableName' format. "
            "Example: 'db1.tableA,db1.tableB;db2.tableC'"
        ),
    )
    args = parser.parse_args()

    input_path = Path(args.input_path)
    output_path = Path(args.output_path)

    # Load input
    input_data = json.loads(input_path.read_text(encoding="utf-8"))
    sql_list = input_data["sql_list"]
    business_requirements = input_data.get("business_requirements", [])
    supplement_knowledge = input_data.get("supplement_knowledge", [])

    # Call APIs to get compilation data and table schemas
    print(f"Processing {len(sql_list)} SQL(s)...")
    print(f"  Metadata via WeData OpenAPI (TAuth user: {args.api_username})")
    if args.cluster:
        print(f"  Cluster: {args.cluster}, ProxyUser: {args.user_name}")
    else:
        print(f"  (Metadata API will be skipped - provide --cluster to enable)")

    # Use externally provided table names (e.g., extracted by LLM)
    table_names_per_sql = _parse_table_names_arg(args.table_names)
    print(f"  Using externally provided table names (skipping SQL parse API)")
    print(f"  Table names per SQL: {table_names_per_sql}")
    api_data = get_sql_data_with_table_names(
        sql_list,
        table_names_per_sql=table_names_per_sql,
        cluster=args.cluster,
        UserName=args.user_name,
        database=args.database,
        api_base=args.api_base,
        api_username=args.api_username,
        api_key=args.api_key,
        service_name=args.service_name,
    )

    # Assemble structured details
    sliced_sql_details = build_sliced_sql_details(sql_list, api_data, business_requirements)

    # Write output (compatible with organize_sql_info.py input format)
    output_data = {
        "sliced_sql_details": sliced_sql_details,
        "supplement_knowledge": supplement_knowledge,
    }
    output_path.write_text(
        json.dumps(output_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Output written to {output_path} ({len(sliced_sql_details)} SQL entries)")
