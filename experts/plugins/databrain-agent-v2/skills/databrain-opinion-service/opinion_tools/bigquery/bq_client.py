"""
Shared BigQuery client and read-only query execution.
Adapted from databrain_host/tools/bigquery/bq_client.py for react agent skill subprocess.

Config is read from AgentContext.rb_config via the common.config globalvar shim.
"""
from typing import Any, Dict, List, Optional
from google.cloud import bigquery
from google.oauth2 import service_account
from opinion_common.config import globalvar as gl


def get_bq_agent_config(use_casual: bool = False) -> Dict[str, Any]:
    """BQ auth & project config from rb_bq_agent_json."""
    try:
        rb = gl.get_value("rb_bq_agent_json", expected_type=dict) or {}
        if use_casual:
            cfg = rb.get("gameplay_creative_agent_config") or rb.get("casual_insight_agent_config") or rb.get("bq_agent_config") or {}
        else:
            cfg = rb.get("bq_agent_config") or {}
        return cfg
    except Exception:
        return {}


def get_bq_client(project_id: str, config: Optional[Dict[str, Any]] = None):
    """Create a BigQuery client using config or default bq_agent_config."""
    bq_agent = config if config is not None else get_bq_agent_config()
    creds_dict = bq_agent.get("bq_config")
    if not creds_dict:
        raise ValueError("bq_agent_config.bq_config is required for BigQuery")
    credentials = service_account.Credentials.from_service_account_info(creds_dict)
    return bigquery.Client(credentials=credentials, project=project_id)


def execute_read_only_sql(
    sql: str,
    project_id: Optional[str] = None,
    max_rows: int = 5000,
    config: Optional[Dict[str, Any]] = None,
    use_casual_config: bool = False,
) -> List[Dict[str, Any]]:
    """Execute a BigQuery query. Call from run_in_executor."""
    cfg = config if config is not None else get_bq_agent_config(use_casual=use_casual_config)
    pid = project_id or cfg.get("project_id") or (cfg.get("bq_config") or {}).get("project_id")
    if not pid:
        raise ValueError("project_id required (set in bq_agent_config or inside bq_config, or pass explicitly)")

    client = get_bq_client(pid, config=cfg)
    job_config = bigquery.QueryJobConfig()
    query_job = client.query(sql, job_config=job_config)
    rows_iter = query_job.result(max_results=max_rows)
    rows = list(rows_iter)
    if not rows:
        return []

    try:
        return [dict(r) for r in rows]
    except TypeError:
        return [dict(zip(r.keys(), r.values())) for r in rows]
