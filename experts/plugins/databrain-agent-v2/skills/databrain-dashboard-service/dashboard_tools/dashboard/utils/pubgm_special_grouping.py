"""Shared PUBGM special grouping constants for planner/query stages."""

PUBGM_SPECIAL_GROUP_USER_IDS = {"sivanchen", "sallyxue", "casseyhan"}
PUBGM_SPECIAL_GAME_CODES = {"i_game"}

# Planner-stage names (display) -> internal group code.
PUBGM_SPECIAL_REGION_GROUP_CODES = {
    "北美": "__pubgm_region_group_north_america__",
    "西欧": "__pubgm_region_group_west_europe__",
    "东欧": "__pubgm_region_group_east_europe__",
    "中东": "__pubgm_region_group_middle_east__",
    "日韩": "__pubgm_region_group_japan_korea__",
    "南美": "__pubgm_region_group_south_america__",
    "南亚": "__pubgm_region_group_south_asia__",
    "东南亚": "__pubgm_region_group_southeast_asia__",
    "其他": "__pubgm_region_group_others__",
}
PUBGM_SPECIAL_CHANNEL_GROUP_CODES = {
    "国际版": "__pubgm_channel_group_global__",
    "越南版": "__pubgm_channel_group_vng__",
    "LITE版": "__pubgm_channel_group_lite__",
    "日韩版": "__pubgm_channel_group_jpkr__",
    "台湾版": "__pubgm_channel_group_tw__",
}

# Query-stage reverse mapping/group ungrouping.
PUBGM_SPECIAL_REGION_GROUP_CODE_TO_LABEL = {
    value: key for key, value in PUBGM_SPECIAL_REGION_GROUP_CODES.items()
}
PUBGM_SPECIAL_CHANNEL_GROUP_CODE_TO_LABEL = {
    value: key for key, value in PUBGM_SPECIAL_CHANNEL_GROUP_CODES.items()
}

PUBGM_SPECIAL_REGION_GROUP_UNGROUP_MAP = {
    "__pubgm_region_group_north_america__": ["North America", "North America-Others"],
    "__pubgm_region_group_west_europe__": ["West Europe", "West Europe-Others"],
    "__pubgm_region_group_east_europe__": ["East Europe", "East Europe-Others"],
    "__pubgm_region_group_middle_east__": ["Middle East", "Middle East-Others"],
    "__pubgm_region_group_japan_korea__": ["Japan", "Korea"],
    "__pubgm_region_group_south_america__": ["South America", "South America-Others", "Brazil"],
    "__pubgm_region_group_south_asia__": ["South Asia", "South Asia-Others"],
    "__pubgm_region_group_southeast_asia__": ["South East Asia", "South East Asia-Others"],
    "__pubgm_region_group_others__": ["Others"],
}
PUBGM_SPECIAL_CHANNEL_GROUP_UNGROUP_MAP = {
    "__pubgm_channel_group_global__": ["APPLE", "DC", "FB", "GC", "Global_Realtime", "GP", "GU", "QQ", "TT", "TW", "UNIFIED", "VK", "WH", "WX"],
    "__pubgm_channel_group_vng__": ["VNGFB", "VNGGP", "VNGGU", "VNGGC", "VNGAPPLE"],
    "__pubgm_channel_group_lite__": ["LITEFB", "LITEGP", "LITEGU", "LITEVK"],
    "__pubgm_channel_group_jpkr__": ["JPKRFB", "JPKRGP", "JPKRTW", "JPKRAPPLE", "JPKRGC", "JPKRGU", "JPKRLINE"],
    "__pubgm_channel_group_tw__": ["TPFB", "TPGP", "TPAPPLE", "TPLINE", "TPGU", "TPGC"],
}
