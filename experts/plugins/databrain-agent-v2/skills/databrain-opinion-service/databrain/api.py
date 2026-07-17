import httpx
import json
import os
from loguru import logger
import requests
import time
import traceback
from typing import Awaitable, Dict, List

from opinion_common.cls import log_metrics
from opinion_common.config import globalvar as gl
from opinion_common.rainbow_utils import init_rainbow

# 情报
INTELLIGENCE_COMPANY_GAMES_API = "/api/v1/intelligence_pc/chatbi/get_top_company_games"    #公司旗下游戏
INTELLIGENCE_GAME_SOURCE_METRICS_API = "/api/v1/intelligence_pc/chatbi/get_game_source_metrics"
INTELLIGENCE_SEARCH_API = "/api/v1/intelligence_pc/chatbi/search"
INTELLIGENCE_ENTITY_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_entity_detail"
INTELLIGENCE_TOP_GAME_API = "/api/v1/intelligence_pc/chatbi/get_top_games"
INTELLIGENCE_TOP_GAME_API_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_top_game_detail"
INTELLIGENCE_TOP_STORE_RANKS_API = "/api/v1/intelligence_pc/chatbi/get_top_store_ranks"
INTELLIGENCE_TOP_STORE_RANK_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_top_store_rank_detail"
INTELLIGENCE_GAME_COMPETITOR_API = "/api/v1/intelligence_pc/chatbi/get_game_competitor_info"
INTELLIGENCE_TOP_MARKET_PROFILES_API = "/api/v1/intelligence_pc/chatbi/get_top_market_profiles"
INTELLIGENCE_TOP_MARKET_PROFILE_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_top_market_profile_detail"
INTELLIGENCE_TOP_GENRE_PROFILES_API = "/api/v1/intelligence_pc/chatbi/get_top_genre_profiles"
INTELLIGENCE_TOP_GENRE_PROFILE_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_top_genre_profile_detail"
INTELLIGENCE_TOP_COMPANY_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_top_company_detail"
INTELLIGENCE_GET_GAME_TAGS_API = "/api/v1/intelligence_pc/chatbi/get_game_tags"
INTELLIGENCE_GET_GAME_GENRES_API = "/api/v1/intelligence_pc/chatbi/get_game_genres"
INTELLIGENCE_GET_GAME_FILTER_TAGS_API = "/api/v1/intelligence_pc/chatbi/get_game_filter_tags"
INTELLIGENCE_TOP_COMPANIES_API = "/api/v1/intelligence_pc/chatbi/get_top_companies"

# Mgmt
MGMT_PERMISSION_API = "/api/v1/mgmt_pc/chatbi/permissions"
MGMT_METRIC_MAP_API = "/api/v1/mgmt_pc/chatbi/metrics"
MGMT_METRIC_CHART_API = "/api/v1/mgmt_pc/chatbi/get_module_detail"
MGMT_METRIC_VALUE_API = "/api/v1/mgmt_pc/chatbi/get_metrics_values"
MGMT_TOP_MODULE_API = "/api/v1/mgmt_pc/chatbi/get_top_modules"

# Dashboard
DASHBOARD_METRIC_API = "/api/v1/dashboard/agent/get_metrics"
DASHBOARD_METRIC_MAP_API = "/api/v1/dashboard/agent/get_metrics_map"
DASHBOARD_GAME_DETAIL_API = "/api/v1/dashboard/agent/get_games_detail"
DASHBOARD_DIMEMSION_TOP_API = "/api/v1/dashboard/agent/get_metric_dimension_top"
DASHBOARD_PC_ENABLE_GAME_LIST_API = "/api/v1/dashboard/agent/pc_enable_game_list"
DASHBOARD_PC_REALTIME_ACC_SALES_UNITS_REVENUE_API = "/api/v1/dashboard/pc/realtime/acc_sales_units_revenue"
DASHBOARD_METRIC_PERCENTAGE_API = "/api/v1/dashboard/agent/get_metric_dimension_percent"

# 舆情接口
OPINION_AGENT_SUMMARY_CREATE_API = "/api/v1/opinion_pc/agent_summary/create"  # 创建关键词分析报告 short_url
GPT_AVAILABILITY_API = "/api/v1/opinion_pc/chat_bi/game_basic_data"  # 高级舆情总结可用性查询接口
GPT_API = "/api/v1/opinion_pc/chat_bi/high_game_gpt_report"  # 带总数统计的gpt报告接口
GPT_API_DATE_RANGE = "/api/v1/opinion_pc/chat_bi/many_date_game_gpt_report"  # 多天gpt报告接口 https://partner.coding.intlgame.com/p/ogdb-backend/wiki/9562
WORDCLOUD_API = "/api/v1/opinion_pc/chat_bi/keyword"  # 词云 https://partner.coding.intlgame.com/p/ogdb-backend/wiki/2879
OPINION_GAME_SEARCH_API = "/api/v1/intelligence_pc/chatbi/search"

ENTITY_DETAIL_API = "/api/v1/intelligence_pc/chatbi/get_entity_detail"
GAME_SEARCH_API = "/api/v1/intelligence_pc/chatbi/search"
# 获取所有工作室和项目，文档: http://databrain-docs.intlgame.com/docs/agent/agent-1h3sg9ftar0mi
ALL_STUDIO_PROJECT_API = "/api/v1/mgmt_pc/chatbi/all_studio_projects"
MGMT_API = "/api/v1/mgmt_pc/chatbi/permissions"
EVENT_LOG_API = "/api/v1/permission/operationLog"
RAINBOW_API = "/api/v1/permission/rainbow"
COS_SIGN_API = "/api/v1/util/cos/presigned_url"
COS_IDENTIFIER = ".cos.ap-singapore.myqcloud.com"

def get_system(url: str) -> str:
    if "dashboard" in url:
        return "dashboard"
    elif "intelligence" in url:
        return "intelligence"
    elif "opinion" in url:
        return "opinion"
    else:
        return "other"


def _get_rb_system_json() -> Dict[str, any]:
    rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
    if isinstance(rb_system_json, dict) and rb_system_json:
        return rb_system_json

    try:
        if not gl.get_value("ENV", expected_type=str):
            gl.set_value("ENV", os.environ.get("ENVIRONMENT", "local"))
        init_rainbow("databrain_host.base", {})
        rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
        if isinstance(rb_system_json, dict) and rb_system_json:
            return rb_system_json
    except Exception:
        logger.warning("rb_system_json lazy init failed: {}".format(traceback.format_exc()))

    # Fallback: skill context writes token/databrain_host into AgentContext directly,
    # not into rb_config. Build a minimal config from those fields so API calls work.
    try:
        from context_loader import get_context
        ctx = get_context()
        token = ctx.token or os.environ.get("DATABRAIN_TOKEN", "")
        host = ctx.databrain_host or os.environ.get("DATABRAIN_HOST", "https://databrain.intlgame.com")
        if token and host:
            logger.info("rb_system_json: falling back to AgentContext token + databrain_host")
            return {"databrain_config": {"token": token, "host": host}, "http_config": {}}
    except Exception:
        logger.warning("AgentContext fallback failed: {}".format(traceback.format_exc()))

    raise RuntimeError("rb_system_json is empty. Please initialize Rainbow config before calling DataBrain API.")


def _get_databrain_config() -> Dict[str, any]:
    rb_system_json = _get_rb_system_json()
    databrain_config = rb_system_json.get("databrain_config")
    if not isinstance(databrain_config, dict) or not databrain_config.get("host"):
        raise RuntimeError("databrain_config is missing or invalid in rb_system_json")
    return databrain_config


def init_send_request(
    api_url: str, data: Dict[str, any], method: str = "POST", custom_warning_seconds: float = 0, **kwargs
) -> requests.Response:
    databrain_config = _get_databrain_config()
    default_token = databrain_config.get("token", "")
    # return send_request_with_token(api_url, data, default_token, method=method, **kwargs)
    # url = databrain_config["host"] + api_url
    return send_request_with_token(api_url, data, default_token, method=method, custom_warning_seconds=custom_warning_seconds, **kwargs)
    # return send_request_with_headers(method, url, {}, data, **kwargs)


def send_request_with_token(
    api_url: str, data: Dict[str, any], token: str, method: str = "POST", message_id: str = "", custom_warning_seconds: float = 0, log_type: str = "", **kwargs
) -> requests.Response:
    """
    send request with token
    """
    databrain_config = _get_databrain_config()
    token = token.strip()

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    if message_id != "":
        headers["Request-Id"] = message_id

    url = databrain_config["host"] + api_url
    return send_request_with_headers(method, url, headers, data, custom_warning_seconds=custom_warning_seconds, log_type=log_type, **kwargs)

def send_request_with_headers(
    method: str, url: str, headers: Dict[str, str], data: dict, api_name: str = "", custom_warning_seconds: float = 0, log_type: str = "", **kwargs
) -> requests.Response:
    start_time = time.time()
    status_code = "0"
    if api_name == "":
        system = get_system(url)
        api_name = "api_{}_{}".format(system, url.split("/")[-1])
    rb_system_json = _get_rb_system_json()
    http_config = rb_system_json.get("http_config", {})
    api_timeout = http_config.get("api_timeout", {}).get(api_name)
    kwargs["timeout"] = api_timeout or 180
    logger.debug(
        f"[{api_name}][request] Call api with url: {url}, method: {method}, data: {data}"
    )
    try:
        if len(headers) == 0:
            response = requests.request(method, url, json=data, **kwargs)
        else:
            response = requests.request(method, url, headers=headers, json=data, **kwargs)
        code = response.json().get("code")
        if code in [400, 500]:  # 业务级错误码
            status_code = str(code)

        # keep request + response on 1 line
        if response and hasattr(response, "content") and response.content:
            logger.info(
                f"[{api_name}][response] Call api with url: {url}, method: {method}, data: {data}\n response: {response.content[:1000]}"
            )
        else:
            logger.error(
                f"[{api_name}][response] Call api with url: {url}, method: {method}, data: {data}\n response: {str(response)[:1000]}", log_type="warning"
            )

        return response
    except (json.decoder.JSONDecodeError) as e:
        status_code = "-1"
        logger.error("http json parse error: {}".format(str(e)), log_type="warning")
    except Exception as e:
        code = "-1"
        status_code = str(code)
        logger.error(f"[api][response] Call api with url: {url}, method: {method}, data: {data} Request failed: {e}", log_type="warning")
    finally:
        time_cost = round((time.time() - start_time) * 1_000, 2)
        log_metrics(api_name, status_code, time_cost)
        http_warning_ms = (custom_warning_seconds or http_config.get("warning_seconds", 3)) * 1_000
        if time_cost > http_warning_ms:
            logger.error(f"[{api_name}][response] api high latency, {time_cost}ms > {http_warning_ms}ms", log_type="latency")

    return None  # Should raise Exception or return None?



async def async_send_request(
    api_url: str, data: Dict[str, any], method: str = "POST", message_id: str = "", **kwargs
) -> httpx.Response:
    rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
    databrain_config = rb_system_json["databrain_config"]
    default_token = databrain_config["token"]
    token = kwargs.pop("token", None)
    if token:
        default_token = token
    return await async_send_request_with_token(api_url, data, default_token, method=method, message_id=message_id, **kwargs)


async def async_send_request_with_token(
    api_url: str, data: Dict[str, any], token: str, api_name: str = "", method: str = "POST", tries: int = 1, message_id: str = "", **kwargs
) -> httpx.Response:
    """
    async send request with token
    """
    rb_system_json = _get_rb_system_json()
    databrain_config = _get_databrain_config()
    headers = {
        "Content-Type": "application/json",
    }
    if message_id:
        headers["Request-Id"] = message_id

    if token != "":
        headers ["Authorization"] = f"Bearer {token}"

    start_time = time.time()
    status_code = "-1"
    if api_name == "":
        system = get_system(api_url)
        api_name = "api_{}_{}".format(system, api_url.split("/")[-1])

    http_config = rb_system_json.get("http_config", {})
    api_timeout = http_config.get("api_timeout", {}).get(api_name)
    kwargs["timeout"] = api_timeout or 180
    logger.info(
        f"[{api_name}] async request {databrain_config['host'] + api_url}, method: {method}, data: {data}"
    )

    last_ex = None
    last_traceback = ""
    async with httpx.AsyncClient(
        base_url=databrain_config["host"],
        headers=headers,
        timeout=None,
    ) as client:
        for _ in range(tries):
            try:
                response = await client.request(method, api_url, json=data, **kwargs)
                response_json = response.json()
                code = response_json.get("code")
                if code in [400, 500]:  # 业务级错误码
                    status_code = str(code)
                else:
                    status_code = "0"

                # keep request + response on 1 line
                logger.info(
                    f"[{api_name}] async response {databrain_config['host'] + api_url}, method: {method}, data: {data}, response: {response.text[:1000]}"
                )
                return response
            except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.ConnectError) as e:
                status_code = "-1"
                logger.error("async http timeout: {} {}s".format(api_name, api_timeout), log_type="latency")
            except json.decoder.JSONDecodeError as e:
                status_code = "-1"
                logger.error("async http json parse error: {}".format(str(e)), log_type="warning")
            except Exception as e:
                status_code = "-1"
                last_ex = e
                last_traceback = traceback.format_exc()
                logger.warning(last_traceback)
            finally:
                time_cost = round((time.time() - start_time) * 1_000, 2)
                log_metrics(api_name, status_code, time_cost)
                http_warning_ms = http_config.get("warning_seconds", 3) * 1_000
                if time_cost > http_warning_ms:
                    logger.error(f"[{api_name}] async response api high latency, {time_cost}ms > {http_warning_ms}ms", log_type="latency")

    if last_ex is not None:
        logger.error(f"[{api_name}] async request failed: {last_traceback}", log_type="warning")
        raise last_ex
    return None

def clean_cos_url(url: str) -> str:
    if COS_IDENTIFIER in url:
        return url.split("?")[0]
    return url

def sign_cos_urls(urls: List[str]) -> List[str]:
    cos_urls = [url for url in urls if COS_IDENTIFIER in url]
    if len(cos_urls) == 0:
        return urls
    new_urls = [None if COS_IDENTIFIER in url else url for url in urls]
    data = {
        "cos_type": "agentCos",
        "url": cos_urls
    }
    resp = init_send_request(COS_SIGN_API, data)
    try:
        resp_json = resp.json()
        signed_cos_urls = resp_json.get("data", {}).get("url", [])
        if len(signed_cos_urls) != len(cos_urls):
            logger.error("signed url length != cos url length")
        else:
            next_idx = 0
            for i, new_url in enumerate(new_urls):
                if new_url is None:
                    new_urls[i] = signed_cos_urls[next_idx]
                    next_idx += 1
            return new_urls
    except:
        logger.warning("failed to sign cos urls: {}".format(cos_urls))

    return urls
