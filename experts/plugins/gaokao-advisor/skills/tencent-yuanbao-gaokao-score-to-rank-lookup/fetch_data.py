#!/usr/bin/env python
"""
高考分数线查询脚本
用法: python fetch_data.py --place 福建 [--year 2024 2023] [--classify 历史 物理] [--score 600] [--rank 1000]
detail:{
    "score" 表示：中间为一个分数，两头是分数段；
    "num" 表示：本分数的人数;
    "total_num" 表示：截止到本分数的累计人数（位次）
}
新增参数：
    --score INT   按分数查询，返回该分数的人数和累计位次（省排名）
    --rank  INT   按位次查询，返回该位次对应的分数区间
注：stdout 仅输出 JSON，调试信息输出到 stderr，方便 LLM 直接读取结果。
"""

import argparse
import bisect
import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import date


BASE_URL = "https://gaokao.search.qq.com/skills_data"
TYPE = "score_range"
SOURCE = "open_tB0fU5wP"
COMMON_RELEASE_MONTH = 6
COMMON_RELEASE_DAY = 23


def _default_year_candidates():
    """Return dynamic latest-year candidates without hard-coding a data year."""
    today = date.today()
    current_year = today.year
    if (today.month, today.day) >= (COMMON_RELEASE_MONTH, COMMON_RELEASE_DAY):
        return [str(current_year), str(current_year - 1)]
    return [str(current_year - 1)]


def _normalize_years(years):
    """Normalize year strings without silently downgrading explicit user years."""
    if not years:
        return _default_year_candidates()

    normalized = []
    for year in years:
        try:
            year_int = int(year)
        except (TypeError, ValueError):
            normalized.append(year)
            continue

        normalized.append(str(year_int))

    return list(dict.fromkeys(normalized))



def fetch_data(year: str, place: str, classify: str, read_key: str, retry_times=1) -> list:
    """从接口获取指定省份的分数线数据，仅读取 read_key 字段"""
    url_prefix = f"{BASE_URL}?type={TYPE}&from={SOURCE}&title={urllib.parse.quote('高考;一分一段表')}"

    if year != "" and year is not None:
        url_prefix += f"&year={year}"

    if place != "" and place is not None:
        url_prefix += f"&place={urllib.parse.quote(place)}"

    if classify != "" and classify is not None:
        url_prefix += f"&classify={urllib.parse.quote(classify)}"

    url = url_prefix

    print("读取数据:", url, file=sys.stderr)

    # import pdb;pdb.set_trace()

    for _ in range(retry_times):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8")
                result = json.loads(raw)
                if result.get("status") != 0:
                    print("接口返回异常。 MSG = {}".format(result.get("message", "")), file=sys.stderr)
                    return []
                return result.get("data", []).get("score_range_res", [])
        except urllib.error.URLError as e:
            print(json.dumps({"error": f"网络请求失败: {str(e)}"}, ensure_ascii=False), file=sys.stderr)
        except json.JSONDecodeError as e:
            print(json.dumps({"error": f"JSON 解析失败: {str(e)}"}, ensure_ascii=False), file=sys.stderr)

    return []


def filter_data(records: list, unwanted_keys: list = None) -> list:
    filtered = []
    for item in records:
        if unwanted_keys and len(unwanted_keys) > 0:
            item = {k: v for k, v in item.items() if k not in unwanted_keys}
        filtered.append(item)
    return filtered


def _parse_score(score_str: str) -> int:
    """
    将 score 字段解析为可比较的整数（取下界）。
    - 普通整数字符串 "694"     → 694
    - 区间字符串     "695-750" → 695（区间下界，用于边界判断）
    """
    if "-" in score_str:
        return int(score_str.split("-")[0])
    return int(score_str)


def _build_index(detail: list) -> tuple:
    """
    将 detail 列表预处理为两个有序数组，便于二分查找。
    detail 按高分→低分排列，total_num 单调递增。

    返回:
        scores     : list[int]  — 每条记录的分数（下界），升序（低分→高分）
        total_nums : list[int]  — 对应的累计人数，降序（配合 scores 的反转）
        detail_rev : list[dict] — 与 scores 对应的反转后 detail
    """
    # 过滤掉无法解析的脏数据
    valid = []
    for item in detail:
        try:
            valid.append((item, _parse_score(item["返回的查询分数"]), int(item["排名位次"])))
        except (KeyError, ValueError, TypeError):
            continue

    # detail 本身高分→低分；反转后变为低分→高分，scores 单调递增，满足 bisect 前提
    valid_rev = list(reversed(valid))
    scores     = [v[1] for v in valid_rev]
    total_nums = [v[2] for v in valid_rev]
    detail_rev = [v[0] for v in valid_rev]
    return scores, total_nums, detail_rev


def _make_result(record: dict, item: dict, user_in: int) -> dict:
    return {
        "年份"                      : record["查询分数线年份"],
        "地区"                       : record["适用地区"],
        "选科类别"                          : record["选科类别"],
        "返回的查询分数"                        : item["返回的查询分数"],
        "同分人数"                   : item["同分人数"],
        "排名位次"  : item["排名位次"],
        "用户输入分数/排名" : user_in,
    }


def query_by_score(records: list, score_list: list) -> list:
    """
    按分数查询，返回该分数的人数和累计位次（省排名）。

    支持传入多个分数（score_list），返回所有分数对应的查询结果列表。
    使用二分法在 scores 数组中定位目标分数：
      - 若命中普通整数分数段，直接返回；
      - 若落在顶部区间（如 "695-750"）内，也能正确匹配。
    时间复杂度 O(M * log N)，其中 M 为查询分数的个数，N 为分数段条目数。
    """
    rst = []
    for record in records:
        detail = record.get("查询数据", [])
        if not detail:
            continue

        # 对每个 record，只需构建一次索引，避免重复计算
        scores, _, detail_rev = _build_index(detail)

        # 遍历传入的多个分数进行查询
        for score in score_list:
            # bisect_right(scores, score) - 1 找到最后一个 <= score 的位置
            # 若 score 低于所有分数（idx=-1），fallback 到最低分行（idx=0）
            idx = bisect.bisect_right(scores, score) - 1
            if idx < 0:
                idx = 0

            item = detail_rev[idx]
            item_score = _parse_score(item["返回的查询分数"])

            # 精确命中：整数分数段完全匹配
            if item_score == score:
                rst.append(_make_result(record, item, score))

            # 区间命中：score 落在形如 "695-750" 的顶部区间内
            # 若 score 超出区间上界（如 751 > 750），也返回该最高分行
            elif "-" in item["返回的查询分数"]:
                rst.append(_make_result(record, item, score))

            # score 低于数据最低分：返回最低分行，表示该分数排名在最末
            elif score < item_score:
                rst.append(_make_result(record, item, score))

    return rst


def query_by_rank(records: list, rank_list: list) -> list:
    """
    按位次查询，返回该位次对应的分数。

    支持传入多个位次（rank_list），返回所有位次对应的查询结果列表。
    total_num 在原始 detail（高分→低分）中单调递增，
    反转后（低分→高分）变为单调递减，不适合直接二分。
    因此在原始顺序（高分→低分）上对 total_num 升序数组做 bisect，
    等价于找第一个 total_num >= rank 的条目。
    时间复杂度 O(M * log N)，其中 M 为查询位次的个数，N 为分数段条目数。
    """
    rst = []
    for record in records:
        detail = record.get("查询数据", [])
        if not detail:
            continue

        # 原始顺序：高分→低分，total_num 单调递增
        # 对每个 record，只需构建一次 total_nums 数组，避免重复计算
        total_nums = []
        for item in detail:
            try:
                total_nums.append(int(item["排名位次"]))
            except (KeyError, ValueError, TypeError):
                total_nums.append(0)

        # 遍历传入的多个位次进行查询
        for rank in rank_list:
            # bisect_left 找到第一个 total_num >= rank 的索引
            # 若 rank 超出最大累计人数，fallback 到最后一行（最低分/最大位次行）
            idx = bisect.bisect_left(total_nums, rank)
            if idx >= len(detail):
                idx = len(detail) - 1

            rst.append(_make_result(record, detail[idx], rank))

    return rst

place_all_list = [
    "北京",
    "天津",
    "河北",
    "山西",
    "内蒙古",
    "辽宁",
    "吉林",
    "黑龙江",
    "上海",
    "江苏",
    "浙江",
    "安徽",
    "福建",
    "江西",
    "山东",
    "河南",
    "湖北",
    "湖南",
    "广东",
    "广西",
    "海南",
    "重庆",
    "四川",
    "贵州",
    "云南",
    "陕西",
    "甘肃",
    "青海",
    "宁夏"
]


def main():
    parser = argparse.ArgumentParser(description="高考地区分数线查询")
    parser.add_argument("--place",    default=None, nargs="*", help="省份名称，如：福建、广东")
    parser.add_argument("--year",     default=None, nargs="*", help="年份列表，如：2024 2023")
    parser.add_argument("--classify", default=None, nargs="*", help="选科列表，如：历史 物理 文科 理科")
    parser.add_argument("--score",  default=None, nargs="*", help="按分数查询：返回该分数的人数和省排名")
    parser.add_argument("--rank",    default=None, nargs="*", help="按位次查询：返回该位次对应的分数区间")
    parser.add_argument("--ip",     default=None, help="按位次查询：返回该位次对应的分数区间")

    args, unknown = parser.parse_known_args()
    if unknown:
        print(f"忽略未知参数: {unknown}", file=sys.stderr)

    if args.place is None:
        if args.ip is None:
            print(json.dumps({
                "ok": False,
                "error": "PLACE_REQUIRED",
                "message": "缺少省份/地区，无法查询一分一段数据。请先补充考生生源省份或报名省份。"
            }, ensure_ascii=False, indent=2))
            return
        else:
            args.place = [args.ip]

    if not isinstance(args.place, list):
        args.place = [args.place]

    year_was_provided = args.year is not None and len(args.year) > 0
    args.year = _normalize_years(args.year)

    if not isinstance(args.year, list):
        args.year = [args.year]

    if not isinstance(args.classify, list):
        args.classify = [args.classify]

    records_list = []


    place_list = []

    for p in args.place:
        if p == "全省":
            place_list.extend(place_all_list)
        else:
            place_list.append(p)

    if year_was_provided:
        for place in place_list:
            for year in args.year:
                for classify in args.classify:
                    records = fetch_data(year, place, classify, read_key="lingxi_doc")
                    records_list.extend(records)
    else:
        for year in args.year:
            year_records = []
            for place in place_list:
                for classify in args.classify:
                    records = fetch_data(year, place, classify, read_key="lingxi_doc")
                    year_records.extend(records)
            if year_records:
                args.year = [year]
                records_list.extend(year_records)
                break


    print(args, file=sys.stderr)

    unwanted_keys = [
        "url", "title", "year_all", "location", "year_select", "item_key", "classify_select"
    ]


    rnt_data = filter_data(records_list, unwanted_keys)

    print("接口返回结果：", file=sys.stderr)
    result = None
    if args.score is not None:
        score = args.score
        if not isinstance(args.score, list):
            score = [score]
        try:
            score = [int(s) for s in score if s]
            result = query_by_score(rnt_data, score)
        except ValueError:
            pass

    # 按位次查询
    if args.rank is not None:
        rank = args.rank
        if not isinstance(args.rank, list):
            rank = [rank]
        try:
            rank = [int(r) for r in rank if r]
            result = query_by_rank(rnt_data, rank)
        except ValueError:
            pass

    if args.score is None and args.rank is None:
        result = query_by_score(rnt_data, [600, 500, 400, 300])
        for item in result:
            item.pop("用户输入分数/排名", None)



    if result and len(result) != 0:
        for item in result:
            item.pop("查询数据", None)
        rnt_data = result

    print(json.dumps(rnt_data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
