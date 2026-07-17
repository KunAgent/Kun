from async_lru import alru_cache
from collections import defaultdict
from loguru import logger

from opinion_tools.opinion.utils.cube_helper import get_cube_client


@alru_cache(maxsize=128, ttl=1800)  # 30分钟缓存，话题信息相对稳定
async def get_topics(game_ids):
    """查询游戏的话题列表， 确保输入是Tuple，以支持缓存"""
    if isinstance(game_ids, list):
        game_ids = tuple(sorted(game_ids))  # 排序确保缓存键一致

    logger.info(f"【get_topics】获取 {len(game_ids)} 个游戏的话题信息")

    filter_game_ids = set(game_ids)
    filter_game_ids.add("-2")  # 通用话题
    filter_game_ids = list(filter_game_ids)

    query = {
        "dimensions": [
            "dim_topic.game_id",
            "dim_topic.topic",
            "dim_topic.topic_zh",
            "dim_topic.parent_topic",
            "dim_topic.parent_topic_zh",
        ],
        "filters": [
            {
                "member": "dim_topic.game_id",
                "operator": "equals",
                "values": filter_game_ids,
            }
        ],
        "ungrouped": True,
    }

    cube_client = get_cube_client()
    response = await cube_client.query(query)
    if error := response.get("error"):
        logger.error(f"Error in get_topics: {error}")
        return {}

    data = response.get("data", [])
    # 将所有字段前缀移除并按游戏和parent_topic双重分组
    grouped_data = defaultdict(lambda: defaultdict(list))
    for item in data:
        processed_item = {}
        game_id = None
        parent_topic = None
        parent_topic_zh = None
        for key, value in item.items():
            # 移除 "dim_topic." 前缀
            new_key = key.replace("dim_topic.", "")
            if new_key == "game_id":
                game_id = value
            elif new_key == "parent_topic":
                parent_topic = value
            elif new_key == "parent_topic_zh":
                parent_topic_zh = value
            else:
                processed_item[new_key] = value

        # 移除为空的topic_zh字段
        if "topic_zh" in processed_item and not processed_item["topic_zh"]:
            del processed_item["topic_zh"]

        if game_id is not None and parent_topic is not None:
            # 生成父话题的key: parent_topic(parent_topic_zh) 或 parent_topic
            if parent_topic_zh:
                parent_topic_key = f"{parent_topic}({parent_topic_zh})"
            else:
                parent_topic_key = parent_topic

            grouped_data[game_id][parent_topic_key].append(processed_item)

    # 转换为普通字典，确保others放在最后
    result = {}
    others_data = None

    for game_id, parent_topics in grouped_data.items():
        if game_id == "-2":
            # 保存others数据，稍后决定是否添加
            others_data = dict(parent_topics)
        else:
            result[game_id] = dict(parent_topics)

    # 检查是否所有传入的game_ids都有话题数据
    input_game_ids = set(game_ids)
    result_game_ids = set(result.keys())
    all_games_have_topics = input_game_ids.issubset(result_game_ids)

    # 只有当不是所有游戏都有话题时，才添加others
    if not all_games_have_topics and others_data is not None:
        result["others"] = others_data

    return result

if __name__ == "__main__":
    import asyncio
    async def main():
        result = await get_topics(["e76337e746e1f95fdbf7e23c26010e448"])
        print(result)
    asyncio.run(main())

