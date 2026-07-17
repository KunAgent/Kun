from loguru import logger
from typing import Dict, Any
import json
import pandas as pd

from opinion_tools.cube.cube_model import Query
from opinion_tools.cube.cube_client import CubeClient
from opinion_tools.cube.transformers import DataTransformer


def format_cube_fields(cube) -> list:
    fields = []
    for dimension in cube.get("dimensions", []):
        if not dimension.get("isVisible"):
            continue
        meta = dimension.get("meta", {})
        fields.append(
            {
                "name": dimension.get("name"),
                "description": dimension.get("description"),
                "dimensions": meta.get("dimensions", True),
                "filters": meta.get("filters", True),
                "measures": False,
            }
        )
    for measure in cube.get("measures", []):
        if not measure.get("isVisible"):
            continue
        meta = measure.get("meta", {})
        fields.append(
            {
                "name": measure.get("name"),
                "description": measure.get("description"),
                "dimensions": False,
                "filters": False,
                "measures": True,
            }
        )
    return fields


def format_cube_meta(meta) -> str:
    description = []
    for cube in meta.get("cubes", []):
        if not cube.get("isVisible"):
            continue
        fields = format_cube_fields(cube)
        description.append(
            {
                "table": cube.get("name"),
                "description": cube.get("description"),
                "fields": fields,
            }
        )
    return description
    # 转csv格式token更少，但agent理解更困难
    # df = pd.DataFrame(fields)
    # fields_str = df.to_csv(index=False)
    # table_str = f"\ntable: {cube.get('name')}\ndescription: {cube.get('description')}\nfields:\n{fields_str}\n"
    # description.append(table_str)
    # return "".join(description)


async def describe_cube_data(cube_client: CubeClient):
    """获取特性报表指标和维度信息"""
    try:
        meta = await cube_client.describe()
        if error := meta.get("error"):
            logger.error(f"Error in data_description: {error}")
            return {
                "error": f"Error: Description of the data is not available: {error}"
            }

        return format_cube_meta(meta)
    except Exception as e:
        logger.error(f"Error in describe_data: {str(e)}")
        return {"error": f"Error: {str(e)}"}


async def read_cube_data(
    cube_client: CubeClient,
    transformer: DataTransformer,
    query: Query,
    language: str = "English",
) -> Dict[str, Any]:
    """
    特性报表数据查询工具：从Cube读取数据。
    Args:
        cube_client: CubeClient实例
        transformer: DataTransformer实例
        query: Query对象，包含查询参数
        language: 语言代码，默认为"English"
    Returns:
        Dict[str, Any]: 查询结果,返回json格式
    """
    try:
        logger.info(f"read_cube_data called with query: {query}")

        # 提取图表相关参数
        chart_params = {"language": language, "legends": query.legends}

        logger.info(f"Chart parameters: {json.dumps(chart_params, ensure_ascii=False)}")

        # 如果order为{}会导致排序失效，应设置为None
        if not query.order:
            query.order = None

        # 转换查询对象为dict
        original_query_dict = query.model_dump(by_alias=True, exclude_none=True)
        original_query_dict["language"] = language

        # 准备Cube查询
        query_dict_for_cube = query.model_dump(
            by_alias=True, exclude_none=True, exclude={"language", "legends"}
        )

        logger.info(f"read_data called with query: {json.dumps(query_dict_for_cube)}")

        # 执行查询
        response = await cube_client.query(query_dict_for_cube)

        if error := response.get("error"):
            logger.warning(f"Error in read_data: {error}")
            return transformer.transform_error(
                f"Error: {error}", original_query=original_query_dict
            )

        # 获取measures格式信息和meta信息
        measures_format = {}
        measures_meta = {}
        dimensions_meta = {}

        annotation = response.get("annotation", {})

        # 处理measures的meta信息
        if response_measures := annotation.get("measures", {}):
            for measure_key, measure_info in response_measures.items():
                if isinstance(measure_info, dict):
                    if "format" in measure_info:
                        measures_format[measure_key] = measure_info["format"]
                    if "meta" in measure_info:
                        measures_meta[measure_key] = measure_info["meta"]

        # 处理dimensions的meta信息
        if response_dimensions := annotation.get("dimensions", {}):
            for dim_key, dim_info in response_dimensions.items():
                if isinstance(dim_info, dict) and "meta" in dim_info:
                    dimensions_meta[dim_key] = dim_info["meta"]

        original_query_dict["measures_format"] = measures_format
        original_query_dict["measures_meta"] = measures_meta
        original_query_dict["dimensions_meta"] = dimensions_meta

        data = response.get("data", [])
        logger.info(f"read_data returned {len(data)} rows")

        # 转换数据
        transformed_data = transformer.transform_read_data(
            data, chart_params, original_query_dict
        )

        return transformed_data

    except Exception as e:
        logger.error(f"Error in read_data: {str(e)}")
        return transformer.transform_error(
            f"Error: {str(e)}", original_query=query.model_dump()
        )
