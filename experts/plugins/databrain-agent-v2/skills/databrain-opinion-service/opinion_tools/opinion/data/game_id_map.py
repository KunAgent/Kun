"""
游戏ID映射配置文件

用于处理一些特殊的 edge case，指导 get_game_info 函数在处理 entity 时选择哪个平台的 ID。

工作原理：
- 当处理 context.entities 时，如果游戏名匹配配置，会强制选择配置指定的平台 ID
- 例如：entity 包含 pc_id、mobile_id 和 console_id，配置指定 "pc"，则强制使用 pc_id
- 如果配置指定的平台不可用（opinion != 2），则回退到自动选择逻辑

配置格式：
{
    "游戏名": {
        "opinions": [
            {
                "game_id": "游戏ID（可选，用于验证）",
                "entity_type": "平台类型(pc/mobile/console)"
            }
        ]
    }
}

注意：
1. 游戏名可以是中文或英文，应与 entity 中的 standard_name/original_name/english_name 匹配
2. entity_type 必须是 "pc", "mobile", 或 "console"
3. entity_type 指定了应该从 entity 中选择 pc_id、mobile_id 还是 console_id
4. game_id 字段是可选的，主要用于配置文档和验证

典型使用场景：
- 游戏同时有 PC 版和 Mobile 版，但用户更关注某个特定平台
- 自动选择逻辑选错了平台，需要手动指定正确的平台
- 某些游戏的平台优先级与默认规则不同

示例：
    "永劫无间": {
        "opinions": [
            {"game_id": "u899803ee342696ca4b84e5344e6c3ee6", "entity_type": "mobile"}
        ]
    }
    # 当查询"永劫无间"时，使用mobile_id而不是pc_id
"""

GAME_ID_MAP = {
    "永劫无间": {
        "opinions": [
            {"game_id": "u899803ee342696ca4b84e5344e6c3ee6", "entity_type": "mobile"},
        ]
    },
    "Naraka: Bladepoint 永劫无间": {
        "opinions": [
            {"game_id": "u899803ee342696ca4b84e5344e6c3ee6", "entity_type": "mobile"},
        ]
    },
    "Naraka: Bladepoint": {
        "opinions": [
            {"game_id": "ea3a8c0f4c15ae15a875184e6fa700dbf", "entity_type": "pc"},
        ]
    },
    "永劫无间手游": {
        "opinions": [
            {"game_id": "u899803ee342696ca4b84e5344e6c3ee6", "entity_type": "mobile"},
        ]
    },
}
