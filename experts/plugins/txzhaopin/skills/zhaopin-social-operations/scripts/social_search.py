#!/usr/bin/env python3
"""
社招 N 路并发搜索 → 去重 → 落盘 JSONL（v6.1.1）

v6.1.1 变化（2026-04-26）：
- **mustCompanies 自动下发**：common_params 里新增 `mustCompanies`（字符串数组，可选）
  作为"宏指令"使用，语义是"用户明指的必要公司（来自 profile.must.companies）"。
  脚本会：
  1. 从 common_params 里 pop 出该字段（不作为搜索参数直接下发给 MCP）
  2. 把它的值注入到**每条 route** 的 `allCompany`（与 route 原有 allCompany 并集去重）
  效果：所有路径的搜索结果都必然命中这些公司（基于简历全部工作经历，由 MCP 后端保证）。
  对应粗筛层 v6.1.1 已删除 must.companies 硬过滤，避免用 lastEmployerName 单字段误杀。
  若 common_params 没有 mustCompanies → 行为完全等同 v6.1.0（向后兼容）。

v6.1.0 城市字段增强（方案 1）：
- API 实测证明 location + expectLocation 是 AND 关系，不是 OR；
- 为实现"当前城市 OR 期望城市 任一满足即召回"，脚本自动把每路拆成两个子请求：
  · 子请求 A：只传 location（当前工作城市路）
  · 子请求 B：只传 expectLocation（期望工作城市路），若 supportNoExpectCity=true 则附带
- 两个子请求并发执行，按 rid 在单路内合并去重后再跨路合并
- 当 common_params.location 为空时，完全退化为旧的单次搜索，向后兼容

使用方法:
    python3 {skillDir}/scripts/social_search.py \
        --params search_params.json \
        --output candidates.jsonl

参数:
    --params  ✅ 必传，搜索参数 JSON 文件路径（结构见下方）
    --output  可选，输出 JSONL 文件路径（默认 candidates.jsonl，落到 cwd）

search_params.json 结构:
{
  "common_params": {                # 所有路共享的参数
    "location": ["深圳"],           # 目标城市（双子请求的输入）
    "supportNoExpectCity": true,    # 可选：是否同时纳入期望城市为空的候选
    "mustCompanies": ["腾讯","字节跳动"],  # ✨ v6.1.1 可选：用户明指公司
    "workYearStart": 5,
    "workYearEnd": 8,
    "minDegree": "本科",
    "locked": 0,
    "size": 30,
    "from": 0
  },
  "routes": [                       # 多路检索（建议 2-5 路）
    {
      "name": "岗位切入",
      "params": {
        "positionTags": ["后台"],
        "searchKey": "存储 网盘 Ceph",
        "searchKeyUseAnd": false
      }
    },
    {
      "name": "经历切入",
      "params": {
        "positionTags": ["后台"],
        "searchKey": "对象存储 分布式存储",
        "searchKeyUseAnd": false
      }
    }
  ]
}

⚠️ expectLocation 不要手写——脚本会从 location 自动派生。
⚠️ mustCompanies 是脚本内部宏指令，不会作为搜索参数直接下发给 MCP；
    真正起作用的是被注入到每条 route 的 allCompany。

脚本会自动：
- 把 common_params 合并到每个 route 的 params
- ✨ v6.1.1：若 common_params.mustCompanies 非空 → 注入到每条 route 的 allCompany
- 为每路生成 diggerSearchId（用户无需提供）
- location 非空时：每路双子请求（location路 / expectLocation路）并发 + rid 合并
- location 为空时：退化为单次搜索（等同 v6.0.1）
- 按 rid 全局去重 + atsRights 非空过滤 + 字段精简 → 落盘 JSONL

字段命名标准：输出 JSONL 与接口原始字段一致（小写驼峰）。
"""

import argparse
import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

# 把 scripts/ 目录加入 path，方便 import mcp_client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp_client import MCPClient, slim_search_result


def load_search_params(path: str) -> tuple:
    """
    加载并校验 search_params.json，返回 (common_params, routes)
    
    routes 中每个 route 已经合并了 common_params，并自动生成 diggerSearchId。

    v6.1.1：若 common_params.mustCompanies 非空 → 从 common_params 剥离，
    注入每条 route 的 allCompany（与 route 原有 allCompany 并集去重）。
    mustCompanies 本身不会作为搜索参数下发给 MCP（它是脚本内部宏指令）。
    """
    if not os.path.exists(path):
        print(f"ERROR: --params 文件不存在: {path}", file=sys.stderr)
        print("  请先生成 search_params.json，结构参见 references/step2-search-templates.md", file=sys.stderr)
        sys.exit(2)
    
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    
    common = cfg.get("common_params") or {}
    raw_routes = cfg.get("routes") or []
    
    if not raw_routes:
        print(f"ERROR: --params 文件中 routes 为空: {path}", file=sys.stderr)
        sys.exit(2)

    # ✨ v6.1.1：提取 mustCompanies 宏指令（用完即扔，不下发给 MCP）
    must_companies = common.pop("mustCompanies", None) or []
    if must_companies and not isinstance(must_companies, list):
        print(f"ERROR: common_params.mustCompanies 必须是数组，收到: {type(must_companies).__name__}",
              file=sys.stderr)
        sys.exit(2)
    if must_companies:
        print(f"[v6.1.1] 启用 mustCompanies={must_companies}，将注入每条 route 的 allCompany",
              file=sys.stderr)

    routes = []
    for r in raw_routes:
        name = r.get("name") or f"route-{len(routes)+1}"
        merged = {**common, **(r.get("params") or {})}
        merged["diggerSearchId"] = f"mcp-recruit-{uuid.uuid4().hex[:12]}"

        # ✨ v6.1.1：mustCompanies 与 route 原有 allCompany 取并集去重
        if must_companies:
            existing_all = merged.get("allCompany") or []
            if isinstance(existing_all, str):  # 兼容误传的字符串
                existing_all = [existing_all]
            merged_all = list(dict.fromkeys(list(must_companies) + list(existing_all)))
            merged["allCompany"] = merged_all
            print(f"  [{name}] allCompany 注入后 = {merged_all}", file=sys.stderr)

        routes.append({"name": name, "params": merged})
    
    return common, routes


def _do_single_search(label: str, params: dict) -> tuple:
    """
    执行一次底层搜索请求，返回 (label, resumes_list, error_msg)

    独立创建 MCPClient，避免多线程 session 竞争。
    """
    size = params.get("size", 30)
    print(f"  [{label}] 启动搜索（单页 {size} 条）...", file=sys.stderr)

    try:
        client = MCPClient()
        client.initialize()
        data = client.search_social_resumes(params)
        if data is None:
            data = {}
    except Exception as e:
        err = str(e)
        print(f"  [{label}] 搜索失败: {e}", file=sys.stderr)
        return label, [], err

    resumes = data.get("resumes", []) or []
    total = data.get("totalCount", 0) or 0
    print(f"  [{label}] ✓ 获取 {len(resumes)} 条, 总命中 {total}", file=sys.stderr)
    return label, resumes, ""


def run_search(route: dict) -> tuple:
    """
    执行单路搜索，返回 (route_name, resumes_list, error_msg)

    v6.1.0 双子请求策略：
    - 若 params.location 非空：拆为两个子请求做 OR
      · 子A：只传 location（当前工作城市路）
      · 子B：只传 expectLocation（期望工作城市路），若 supportNoExpectCity=true 则附带
      · 两子请求并发执行，按 rid 在单路内合并去重
    - 若 params.location 为空：退化为单次搜索（旧逻辑）
    - 子请求之一失败、另一路成功 → 整路仍视为成功
    """
    name = route["name"]
    base_params = route["params"].copy()

    # 提取城市控制字段（从 base_params 里剥离，避免污染子请求）
    location = base_params.pop("location", None) or []
    expect_location_user = base_params.pop("expectLocation", None)  # 理论上用户不该写，但兜底
    support_no_expect = base_params.pop("supportNoExpectCity", False)

    # 场景 1：用户没指定城市 → 退化单次（旧行为）
    if not location:
        # 若用户手写了 expectLocation，仍然尊重
        if expect_location_user:
            base_params["expectLocation"] = expect_location_user
        label, resumes, err = _do_single_search(name, base_params)
        return name, resumes, err

    # 场景 2：用户指定了城市 → 双子请求 OR 合并
    params_current = base_params.copy()
    params_current["location"] = location
    params_current["diggerSearchId"] = f"mcp-recruit-{uuid.uuid4().hex[:12]}"

    params_expect = base_params.copy()
    params_expect["expectLocation"] = location
    if support_no_expect:
        params_expect["supportNoExpectCity"] = True
    params_expect["diggerSearchId"] = f"mcp-recruit-{uuid.uuid4().hex[:12]}"

    # 双子请求并发
    results = {}
    errors = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {
            executor.submit(_do_single_search, f"{name}·当前", params_current): "current",
            executor.submit(_do_single_search, f"{name}·期望", params_expect): "expect",
        }
        for fut in as_completed(futures):
            tag = futures[fut]
            try:
                _, resumes, err = fut.result()
                if err:
                    errors.append(f"{tag}: {err}")
                results[tag] = resumes
            except Exception as e:
                errors.append(f"{tag}: {e}")
                results[tag] = []

    # 单路内按 rid 合并去重
    merged = {}
    for tag in ("current", "expect"):
        for r in results.get(tag, []):
            rid = r.get("rid", "") or r.get("Rid", "")
            if rid and rid not in merged:
                merged[rid] = r

    merged_list = list(merged.values())
    cur_n = len(results.get("current", []))
    exp_n = len(results.get("expect", []))
    print(f"  [{name}] ✓ 合并后 {len(merged_list)} 条（当前路 {cur_n} + 期望路 {exp_n}，rid 去重）",
          file=sys.stderr)

    # 只有两个子请求都失败才算整路失败
    if not merged_list and len(errors) == 2:
        return name, [], "; ".join(errors)
    return name, merged_list, ""


def dedup_by_rid(all_resumes: list) -> list:
    """按 rid 去重，保留首次出现的。支持大小写两种字段名（搜索接口实测为小写 rid）。"""
    seen = set()
    result = []
    for r in all_resumes:
        rid = r.get("rid", "") or r.get("Rid", "")
        if not rid or rid in seen:
            continue
        seen.add(rid)
        result.append(r)
    return result


def main():
    parser = argparse.ArgumentParser(description="社招简历搜索（3 路并发 + 去重 + 落盘）")
    parser.add_argument("--params", required=True,
                        help="搜索参数 JSON 文件路径（结构见脚本 docstring）")
    parser.add_argument("--output", "-o", default="candidates.jsonl",
                        help="输出 JSONL 文件路径（默认 candidates.jsonl，落到当前 workspace）")
    args = parser.parse_args()

    output_path = os.path.abspath(args.output)

    print("=" * 60, file=sys.stderr)
    print("社招简历搜索 — N 路并发 + 城市双子请求 + 去重 (v6.1.1)", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # 加载搜索参数
    _, routes = load_search_params(args.params)
    print(f"加载 {len(routes)} 路检索参数（来自 {args.params}）", file=sys.stderr)

    # ━━━━━━━━━━ 并发搜索 ━━━━━━━━━━
    all_resumes = []
    route_stats = []
    failed_routes = []

    print(f"\n开始 {len(routes)} 路并发搜索（每路独立会话）...", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=len(routes)) as executor:
        futures = {executor.submit(run_search, route): route["name"] for route in routes}

        for future in as_completed(futures):
            route_name = futures[future]
            try:
                name, resumes, error_msg = future.result()
                if error_msg:
                    route_stats.append({"name": name, "count": len(resumes), "error": error_msg})
                    if len(resumes) == 0:
                        failed_routes.append(name)
                else:
                    route_stats.append({"name": name, "count": len(resumes)})
                all_resumes.extend(resumes)
            except Exception as e:
                print(f"  [{route_name}] 执行异常: {e}", file=sys.stderr)
                route_stats.append({"name": route_name, "count": 0, "error": str(e)})
                failed_routes.append(route_name)

    # 全部失败 → 退出
    if len(failed_routes) == len(routes):
        print(f"\n❌ 全部 {len(routes)} 路搜索失败！请检查网络或 MCP 服务状态", file=sys.stderr)
        summary = {
            "status": "error",
            "message": "所有搜索路线均失败",
            "route_stats": route_stats,
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        sys.exit(1)

    if failed_routes:
        print(f"\n⚠️ {len(failed_routes)}/{len(routes)} 路搜索失败: {failed_routes}", file=sys.stderr)
        print(f"继续处理成功的 {len(routes) - len(failed_routes)} 路结果...", file=sys.stderr)

    print(f"\n合计原始: {len(all_resumes)} 条", file=sys.stderr)

    # 去重
    unique = dedup_by_rid(all_resumes)
    print(f"去重后: {len(unique)} 条", file=sys.stderr)

    # 过滤 atsRights 不为空的（无权限查看）
    unlocked = [r for r in unique if not r.get("atsRights")]
    if len(unlocked) == 0:
        unlocked = unique
        print(f"[warn] atsRights 过滤后为空，保留全部 {len(unique)} 条", file=sys.stderr)
    elif len(unlocked) < len(unique):
        print(f"过滤无权限后: {len(unlocked)} 条（移除 {len(unique) - len(unlocked)} 条 atsRights 非空）",
              file=sys.stderr)
    else:
        print(f"全部可用: {len(unlocked)} 条", file=sys.stderr)

    # 精简字段 + 落盘
    with open(output_path, "w", encoding="utf-8") as f:
        for r in unlocked:
            slim = slim_search_result(r)
            f.write(json.dumps(slim, ensure_ascii=False) + "\n")

    print(f"\n已写入: {output_path}", file=sys.stderr)
    print(f"共 {len(unlocked)} 条候选人", file=sys.stderr)

    # 输出摘要到 stdout（供 Agent 读取）
    # ⚠️ 不输出任何 rid，避免污染上下文。rid 唯一来源是 rough_screen.py 的输出文件。
    summary = {
        "status": "ok",
        "output_file": output_path,
        "route_stats": route_stats,
        "total_raw": len(all_resumes),
        "total_deduped": len(unique),
        "total_saved": len(unlocked),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
