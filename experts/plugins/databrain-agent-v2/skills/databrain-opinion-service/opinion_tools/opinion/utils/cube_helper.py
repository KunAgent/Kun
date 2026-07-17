from async_lru import alru_cache
from loguru import logger

from opinion_tools.cube.cube_client import CubeClient
from opinion_tools.cube.cube_tools import describe_cube_data
from opinion_utils.df_analyzer import DataFrameAnalyzer
from opinion_common.config import globalvar as gl


def _describe_data(df, group_by_fields):
    """描述数据，返回描述信息"""
    df_analyzer = DataFrameAnalyzer(df)
    return df_analyzer.describe(group_by_fields=group_by_fields, agg_functions=['mean', 'min', 'max', 'sum'])


@alru_cache(maxsize=128, ttl=1800)  # 30分钟缓存，数据描述变化极少
async def describe_data():
    """获取 Opinion Cube 数据描述"""
    logger.info("【Opinion Agent Performance】describe_data调用")
    cube_client = get_cube_client()
    return await describe_cube_data(cube_client)


def get_cube_client():
    """获取 Opinion Cube Client"""
    rb_system_json = gl.get_value("rb_system_json", expected_type=dict) or {}
    cube_config = rb_system_json.get("opinion_cube")
    if not cube_config or not isinstance(cube_config, dict):
        raise RuntimeError(
            "opinion_cube config is missing or empty in rb_system_json. "
            "Please ensure Rainbow config contains opinion_cube.host and opinion_cube.api_secret."
        )
    host = cube_config.get("host")
    api_secret = cube_config.get("api_secret")
    if not host:
        raise RuntimeError(
            "opinion_cube.host is missing in rb_system_json. "
            "Please check Rainbow config for opinion_cube section."
        )
    return CubeClient(
        endpoint=f"{host}/cubejs-api/v1",
        api_secret=api_secret or "",
        security_context={},
    )

