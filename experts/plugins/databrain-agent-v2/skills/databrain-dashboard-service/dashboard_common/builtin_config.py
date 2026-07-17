"""Built-in config for standalone dashboard skill.

All config values are embedded here (originally from Rainbow system.json).
Only DATABRAIN_TOKEN needs to be set by the user via environment variable.
Set DATABRAIN_ENV=pre to switch to pre environment.

No LLM config is included — the standalone skill does not make any LLM calls.
"""
import os

# Environment: "prod" (default) or "pre"
_ENV = os.environ.get("DATABRAIN_ENV", "prod").strip().lower()

# DataBrain API host
DATABRAIN_HOST = (
    "https://databrain-pre.intlgame.com" if _ENV == "pre"
    else "https://databrain.intlgame.com"
)

# HTTP config
HTTP_CONFIG = {
    "warning_seconds": 15,
    "api_timeout": {
        "api_intelligence_search": 8
    }
}

# Dashboard MCP config (token uses user's DATABRAIN_TOKEN at runtime)
_MCP_HOST = (
    "https://databrain-pre.intlgame.com/mcp/cube/sse" if _ENV == "pre"
    else "https://databrain.mcp.it.woa.com"
)

DASHBOARD_MCP = {
    "host": _MCP_HOST,
    "prod_host": "https://databrain.mcp.it.woa.com",
    "mcp_white_games": ["demo", "dl_the_beast", "pool", "triplematch", "subway", "dl", "dl2", "hok", "nikke_overall"]
}


def build_rb_config() -> dict:
    """Build rb_config dict from embedded constants + user token from env var.

    The user's DATABRAIN_TOKEN is used everywhere a token is needed
    (databrain_config, dashboard_mcp, etc.).
    """
    token = os.environ.get("DATABRAIN_TOKEN", "")

    mcp = dict(DASHBOARD_MCP)
    mcp["token"] = token

    return {
        "databrain_config": {
            "host": DATABRAIN_HOST,
            "token": token,
        },
        "http_config": HTTP_CONFIG,
        "dashboard_mcp": mcp,
        "agent_config": {},
        "litellm_config": {},
        "url_map": {},
        "rb_url_map_json": {},
        "rb_strategy_json": {
            "entities": [],
            "agent_rules": {},
        },
        "rb_test_json": {},
        "exa_api_key_list": [],
        "supported_metrics_and_sources": {},
        "ENV": _ENV,
    }
