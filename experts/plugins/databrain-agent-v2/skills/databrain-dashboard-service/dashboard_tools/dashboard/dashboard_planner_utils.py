from run_context_wrapper import RunContextWrapper
from loguru import logger
import time
import traceback
from typing import Any, Dict, List, Tuple

from dashboard_common.cls import log_metrics

from databrain.api import DASHBOARD_GAME_DETAIL_API, DASHBOARD_PC_ENABLE_GAME_LIST_API, async_send_request_with_token
from dashboard_strategy.context import GameContext
from dashboard_strategy.constants import DashboardType
from dashboard_strategy.entity import clean_game_name
from dashboard_tools.dashboard.utils.pubgm_special_grouping import (
    PUBGM_SPECIAL_CHANNEL_GROUP_CODES,
    PUBGM_SPECIAL_GAME_CODES,
    PUBGM_SPECIAL_GROUP_USER_IDS,
    PUBGM_SPECIAL_REGION_GROUP_CODES,
)


class DashboardException(Exception):
    """Custom exception for dashboard agent."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardWrongTokenException(DashboardException):
    """Custom exception for dashboard wrong token issues."""

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class DashboardPermissionException(DashboardException):
    """Custom exception for dashboard permission issues."""

    def __init__(self, game):
        super().__init__(
            f"User does not have permission to access dashboard info for game {game}. "
        )
        self.game = game


def _apply_pubgm_special_group_filters(
    user_id: str,
    game_code: str,
    filter_name: str,
    filter_codes: Dict[str, str],
) -> Dict[str, str]:
    """Inject special PUBGM grouped filter aliases for dedicated users."""
    if (user_id or "").lower() not in PUBGM_SPECIAL_GROUP_USER_IDS:
        return filter_codes
    if (game_code or "").lower() not in PUBGM_SPECIAL_GAME_CODES:
        return filter_codes
    if filter_name == "region":
        return PUBGM_SPECIAL_REGION_GROUP_CODES.copy()
    if filter_name == "channel":
        return {**filter_codes, **PUBGM_SPECIAL_CHANNEL_GROUP_CODES}
    return filter_codes

# def update_game_context_permission_status(context: RunContextWrapper[GameContext], has_dashboard_data):
#     """
#     Given the new has_dashboard_data, update has_dashboard_data in game context
#
#     Args:
#         context (RunContextWrapper[GameContext]): game context
#         has_dashboard_data (dict): the new has_dashboard_data dict that represents permission status for games queried in this agent call
#     """
#
#     context.context.has_dashboard_data_list.append(has_dashboard_data)
#     print(
#         f"\033[93m Update game context has_dashboard_data with: {context.context.has_dashboard_data_list}\033[0m"
#     )


# TODO： 已停用function，check必要性，是否可以删除？
async def query_dashboard_game_detail(token: str, game_names: List[str], entity_types: List[str]) -> Tuple[Dict[str, any], Dict[str, any]]:
    """
    Given a list of game names, return their game info like game code, game type, filter info (results), and their permission status (has_dashboard_data)

    Args:
        token (str): user token for api call
        game_names (list): game names whose details to query
        entity_types (list): entity type of games (however in practice this does not make any differences for current api)

    Returns:
        results (dic): a mapping from game names to its game info, in the format of: {game_name: {game_name: gn, game_code: gc, game_type: gt, channel: [], ...}, }
        has_dashboard_data (dic): permission json in the format of: {type: "dashboard_1/2/3/4", white_games: [], black_games: [], error_games: []}, as listed in section 4.1 in this doc: https://doc.weixin.qq.com/doc/w3_AA4AMgbpAEsCNQsH1Bf9TQ7S37POD?scode=AJEAIQdfAAo1pv2K3RAA4AMgbpAEs
    """

    logger.info(f"【Tool call】-【dashboard_query_dashboard_game_detail】: Found input: {game_names}, {entity_types}. ")

    # guarantee return of has_dashboard_data = {} if any exception encountered
    try:

        # handle invalid inputs
        assert game_names is not None and len(game_names) > 0, "game_names is required to retrieve game details. Retry with correct input. "
        if not isinstance(game_names, list):
            game_names = [game_names]
        game_names = [clean_game_name(x) for x in game_names]


        logger.info(
            f"【Tool API Call】-【query_dashboard_game_detail】: Querying {entity_types} game details for {game_names}. "
        )

        # retrieve game details
        data = {"game_names": game_names, "entity_type": entity_types}

        print(
            f"\033[93m Call query_dashboard_game_detail with url: {DASHBOARD_GAME_DETAIL_API} with data: {data}.\033[0m"
        )

        try:
            response = await async_send_request_with_token(DASHBOARD_GAME_DETAIL_API, data, token)
            assert response is not None, f"response from DASHBOARD_GAME_DETAIL_API call should not be None. "
        except Exception as e:
            logger.error(traceback.format_exc())
            logger.info(f"Tried dashboard_game_detail_api, encountered error: {e}. Retry with same input. ")
            response = await async_send_request_with_token(DASHBOARD_GAME_DETAIL_API, data, token)

        response_json = response.json()
        code = response_json.get("code", -1)
        if code == 4001:
            raise DashboardWrongTokenException("DashboardWrongTokenException: Token used is expired or wrong version of the token is used. Try using the latest token. ")
        assert code == 0, f"DASHBOARD_GAME_DETAIL_API return unsuccessful with code = {code}. "

        logger.info(
            f"【Tool API Return】-【query_dashboard_game_detail】: {response_json}. "
        )

        print(
            f"\033[93m Get response from query_dashboard_game_detail with data: {response_json}\033[0m"
        )

        # handle api outputs
        results = {}
        has_dashboard_data: Dict[str, any] = {
            "white_games": [],
            "black_games": [],
            "error_games": [],
            "retrieved_data_games": [],
        }

        for data in response_json["data"]:
            curr = {}
            curr["game_name"] = data["game_name"]
            curr["game_code"] = data["dashboard"]["game_code"]
            curr["game_type"] = data["dashboard"]["game_type"]
            curr["has_permission"] = data["dashboard"]["has_permission"]
            curr["cover"] = data["dashboard"].get("cover", "")
            curr["key_country"] = data["dashboard"].get("key_country", [])
            # for k in ["channel", "os", "zone", "region", "lang", "country", "category", "product"]:
            filter_names = ["channel", "os", "zone", "region", "lang", "category"] if curr["game_code"] == "poe2" else ["channel", "os", "zone", "region", "lang", "category", "product"]
            for k in filter_names:  # use seperate function to identify country codes
                if data["dashboard"].get(k, []):
                    curr[k] = data["dashboard"].get(k, [])
            results[data["game_name"]] = curr

            # check dashboard game permission status (1/2/3/4)
            if data["dashboard"]["game_code"] and data["dashboard"]["has_permission"]:
                has_dashboard_data["white_games"].append(data["game_name"])
            elif data["dashboard"]["game_code"] and not data["dashboard"]["has_permission"]:
                has_dashboard_data["black_games"].append(data["game_name"])
            else:
                has_dashboard_data["error_games"].append(data["game_name"])

        # generate has_dashboard_data
        if len(results) == len(has_dashboard_data["white_games"]):
            has_dashboard_data["type"] = DashboardType.Dashboard_4.value
        elif len(has_dashboard_data["white_games"]) >= 1:
            has_dashboard_data["type"] = DashboardType.Dashboard_3.value
        elif len(results) == len(has_dashboard_data["black_games"]):
            has_dashboard_data["type"] = DashboardType.Dashboard_2.value
        else:
            has_dashboard_data["type"] = DashboardType.Dashboard_1.value

        logger.info(f"【Tool return】-【dashboard_query_dashboard_game_detail】: results: {results}, has_dashboard_data: {has_dashboard_data}. ")

        return results, has_dashboard_data

    except Exception as e:
        logger.warning(f"【Tool return】-【dashboard_query_dashboard_game_detail】: Error occurred: {e}, returning: results: {str(e)}, has_dashboard_data: {{}}. ")
        logger.warning(traceback.format_exc())

        return str(e), {
            "white_games": [],
            "black_games": [],
            "error_games": [],
            "retrieved_data_games": [],
        }



async def query_dashboard_game_detail_v2(context: GameContext,) -> Tuple[Dict[str, any], Dict[str, any]]:
    """
    Given data of a list of game codes and their entity info, return their permission status (has_dashboard_data)

    Args:
        context (GameContext): game context to retrieve info from

    Returns:
        results (dic): a mapping from game names to its game info, in the format of: {game_name: {game_name: gn, game_code: gc, game_type: gt, channel: [], ...}, }
        has_dashboard_data (dic): permission json in the format of: {type: "dashboard_1/2/3/4", white_games: [], black_games: [], error_games: []}, as listed in section 4.1 in this doc: https://doc.weixin.qq.com/doc/w3_AA4AMgbpAEsCNQsH1Bf9TQ7S37POD?scode=AJEAIQdfAAo1pv2K3RAA4AMgbpAEs
    """

    try:

        # handle invalid inputs
        assert context.entities, "GameContext.entities is required to retrieve game details. Retry with correct input. "
        assert context.game_names, "GameContext.game_names is required to retrieve game details. Retry with correct input. "

        # handle api outputs
        results = {}
        # guarantee return of has_dashboard_data = {} if any exception encountered
        has_dashboard_data: Dict[str, any] = {"white_games": [], "black_games": [], "error_games": [], "retrieved_data_games":[]}
        key_country = {}
        game_icon_mapping = {}
        for game_name in context.game_names:
            game_entity = None
            for e in context.entities:
                if e.get('keyword', '') == game_name or e.get('list', [{}])[0].get('game_name', '') == game_name or e.get('list', [{}])[0].get('entity_name', '') == game_name:
                    game_entity = e.get('list', [{}])[0]
                    break
            dashboard_info = game_entity['dashboard_info'] if game_entity['dashboard_info'] else game_entity['pc_dashboard_info'] if game_entity['pc_dashboard_info'] else {}
            if not game_entity or not dashboard_info:
                continue
            logger.info(f"【Tool call】-【dashboard_query_dashboard_game_detail_v2】. {game_entity}")
            curr = {}
            curr["game_name"] = game_name
            curr["game_code"] = dashboard_info["game_code"]
            curr["game_type"] = dashboard_info["game_type"]
            # curr["has_permission"] = game_entity['dashboard_info']["has_permission"]
            filter_names = ["channel", "os", "region", "lang", "category", "product"] if curr["game_code"]=='nikke_cn' else ["channel", "os", "zone", "region", "lang", "category", "product"]
            os_types = set()
            for k in filter_names:  # use seperate function to identify country codes
                if dashboard_info.get(k, []):
                    filter_codes = dashboard_info.get(k, [])
                    if not filter_codes:
                        continue
                    if "os" == k:
                        os_types = set([item["os_type"].lower() for item in filter_codes if '255' not in item.values() and len(item["os_type"]) > 0])
                        os_names = set([item["os_name"].lower() for item in filter_codes if '255' not in item.values()])
                        new_filter_codes = {item['os_name']: item['os_code'] for item in filter_codes if
                                            '255' not in item.values()}
                        if "mobile" in os_types or 'android' in os_names or 'ios' in os_names:
                            new_filter_codes['Mobile'] = 'mobile'
                        if "pc" in os_types or 'Steam' in os_names:
                            new_filter_codes['PC'] = 'pc'
                        if "console" in os_types or 'xbox' in os_names or 'playstation' in os_names:
                            new_filter_codes['Console'] = 'console'
                        if "Heybox" in new_filter_codes.keys():
                            new_filter_codes['小黑盒'] = new_filter_codes['Heybox']
                        if "heybox" in new_filter_codes.keys():
                            new_filter_codes['小黑盒'] = new_filter_codes['heybox']
                        if "Official Website" in new_filter_codes.keys():
                            new_filter_codes['官网'] = new_filter_codes['Official Website']
                        if "official website" in new_filter_codes.keys():
                            new_filter_codes['官网'] = new_filter_codes['official website']
                    else:
                        name = 'category_en_name' if "category" == k else 'product_en_name' if 'product' == k else f'{k}_name'
                        new_filter_codes = {item[name]: item[f'{k}_code'] for item in filter_codes if
                                            '255' not in item.values()}
                    new_filter_codes = _apply_pubgm_special_group_filters(
                        user_id=getattr(context, "user_id", ""),
                        game_code=curr["game_code"],
                        filter_name=k,
                        filter_codes=new_filter_codes,
                    )
                    #add 255 to the available codes
                    new_filter_codes['255'] = '255'
                    curr[k] = new_filter_codes
            if len(os_types) > 1:
                curr["has_multiple_os_types"] = os_types
            results[game_name] = curr
            key_country[curr["game_code"]] = [y.get("country_code") for y in dashboard_info.get("key_country", [])]
            game_icon_mapping[curr["game_code"]] = dashboard_info.get("cover", "")
            # check dashboard game permission status (1/2/3/4)
            if dashboard_info["game_code"] and dashboard_info["has_permission"]:
                has_dashboard_data["white_games"].append(game_name)
            elif dashboard_info["game_code"] and not dashboard_info["has_permission"]:
                has_dashboard_data["black_games"].append(game_name)
            else:
                has_dashboard_data["error_games"].append(game_name)

        # generate has_dashboard_data
        if not results:
            has_dashboard_data["type"] = DashboardType.Dashboard_1.value
        else:
            if len(results) == len(has_dashboard_data["white_games"]):
                has_dashboard_data["type"] = DashboardType.Dashboard_4.value
            elif len(has_dashboard_data["white_games"]) >= 1:
                has_dashboard_data["type"] = DashboardType.Dashboard_3.value
            elif len(results) == len(has_dashboard_data["black_games"]):
                has_dashboard_data["type"] = DashboardType.Dashboard_2.value
            else:
                has_dashboard_data["type"] = DashboardType.Dashboard_1.value

        logger.info(f"【Tool return】-【dashboard_query_dashboard_game_detail_v2】: results: {results}, has_dashboard_data: {has_dashboard_data}. ")

        context.game_icon_mapping = game_icon_mapping
        context.key_country = key_country
        return results, has_dashboard_data

    except Exception as e:
        logger.info(f"【Tool return】-【dashboard_query_dashboard_game_detail_v2】: Error occurred: {e}, returning: results: {str(e)}, has_dashboard_data: {{}}. ")
        return {}, {
            "white_games": [],
            "black_games": [],
            "error_games": [],
            "retrieved_data_games": [],
        }


async def query_dashboard_pc_enable_game_list(context: GameContext) -> List[str]:
    """Fetch /pc_enable_game_list; store filtered item list (non-empty game_code) on context.dashboard_pc_enable_game_list_raw."""

    def _filter_pc_enable_items(items: Any) -> List[dict]:
        out: List[dict] = []
        if not isinstance(items, list):
            return out
        for item in items:
            if not isinstance(item, dict):
                continue
            code = str(item.get("game_code") or "").strip()
            if not code:
                continue
            out.append(item)
        return out

    try:
        response = await async_send_request_with_token(
            DASHBOARD_PC_ENABLE_GAME_LIST_API,
            {},
            context.token,
            message_id=context.message_id or "",
        )
        response_json = response.json() if response is not None else {}
        if not isinstance(response_json, dict):
            context.dashboard_pc_enable_game_list_raw = []
            return []

        data = response_json.get("data") or []
        items = data if isinstance(data, list) else []
        filtered_items = _filter_pc_enable_items(items)
        context.dashboard_pc_enable_game_list_raw = filtered_items

        if response_json.get("code") != 0:
            logger.warning(
                "query_dashboard_pc_enable_game_list failed: {}",
                response_json,
            )
            return []

        seen_codes = set()
        game_codes: List[str] = []
        for item in filtered_items:
            code = str(item.get("game_code") or "").strip()
            if code not in seen_codes:
                seen_codes.add(code)
                game_codes.append(code)
        logger.info(
            "query_dashboard_pc_enable_game_list success, total={}, filtered_rows={}, valid_codes={}",
            len(items),
            len(filtered_items),
            len(game_codes),
        )
        return game_codes
    except Exception:
        logger.warning("query_dashboard_pc_enable_game_list error: {}", traceback.format_exc())
        context.dashboard_pc_enable_game_list_raw = []
        return []

#TODO： rename, check necessary
async def x(
    context: RunContextWrapper[GameContext],
) -> str:
    """Query the game_code and available filters for a list of game name.
    If any of the input variables is not specify by the user, do not ask them, use default values.

    Args:
        game_names (List[str]): The name of the game to query. This should not contain any info on the game types, such as "(mobile)". Any game type info should be passed on in entity_types. Defaults to None.

    Returns:
        str: Format like {game_name: {"game_name": game_name, "game_code": game_code, "game_type": game_type, "available_filter_name": {"filter_value": filter_value, "filter_code": filter_code}}}
    """

    logger.info(
        f"【Functool Call】-【dashboard_game_code_and_filters_query_tool】: {context.context.game_names}. "
    )

    start_time = time.time()
    token = context.context.token

    # Get game code
    try:
        # results, has_dashboard_data = await query_dashboard_game_detail(token, game_names, entity_types)
        results, _ = await query_dashboard_game_detail_v2(context.context)
        assert isinstance(results, dict), "Try querying game details, but error occurred during the process: " + \
            str(results if isinstance(results, str) else "Unknown error.")
    except Exception as e:
        return str(e)

    try:
        context.context.game_icon_mapping = {
            x.get("game_code"): x.get("cover") for x in results.values()}
    except Exception as e:
        logger.error(str(e))
        context.context.game_icon_mapping = {}

    try:
        context.context.key_country = {x.get("game_code"): [y.get(
            "country_code") for y in (x.get("key_country") or [])] for x in results.values()}
    except Exception as e:
        logger.error(str(e))
        context.context.key_country = {}
        if isinstance(results, dict):
            for x in results.values():
                if isinstance(x, dict) and "game_code" in x:
                    context.context.key_country[x["game_code"]] = [
                        'br', 'mx', 'ru', 'tr', 'us']

    log_metrics("dashboard_game_code_and_filters_query_tool",
                "0", round((time.time() - start_time) * 1000, 2))
    return f"Querying game_code, game_type and available filters for {context.context.game_names}, here's the result: {results}. "[:8000000]
