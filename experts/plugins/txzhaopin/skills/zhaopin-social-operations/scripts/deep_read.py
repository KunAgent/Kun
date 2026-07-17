#!/usr/bin/env python3
"""
社招精读脚本 — 分批获取简历详情并过滤字段（支持早停机制）

用法: 
  python deep_read.py --rids rid1,rid2,rid3 --offset 0 --limit 5

参数:
  --rids      逗号分隔的完整 rid 列表
  --offset    起始位置（从第几个开始，默认 0）
  --limit     本批数量（默认 5）
  --rate-limit 频率控制：每多少个暂停 1 秒（默认 5）

输出到 stdout: JSON 对象，包含本批精简后的简历详情
"""

import argparse
import json
import sys
import time
from mcp_client import MCPClient


def slim_detail(raw: dict) -> dict:
    """
    从完整详情中提取精读需要的字段（大幅减少 Token 消耗）
    
    输入: MCP 返回的完整详情 {"resume": {...}, "flowList": [...], "contactRecords": [...]}
    输出: 精简后的字典，只保留评估所需字段
    """
    resume = raw.get("resume", {}) or {}
    flow_list = raw.get("flowList", []) or []
    
    # 基本信息
    slim = {
        "rid": resume.get("RID", resume.get("rid", "")),
        "name": resume.get("name", ""),
        "age": resume.get("age", 0),
        "gender": resume.get("gender", ""),
        "workCity": resume.get("workCity", ""),
        "workYears": resume.get("extendWorkYearValue", 0),
        "currentJobTitle": resume.get("currentJobTitle", ""),
        "lastCompany": resume.get("lastCompany", ""),
        "education": resume.get("education", ""),
        "school": resume.get("school", ""),
        "status": resume.get("status", 0),
        "statusText": resume.get("statusText", ""),
        "isLock": resume.get("isLock", False),
    }
    
    # 工作经历（只取前 2 段，workSummary 截断 200 字）
    work_exp = resume.get("resumeWorkExp", []) or []
    slim_work = []
    for exp in work_exp[:2]:
        summary = exp.get("workSummary", "") or ""
        slim_work.append({
            "company": exp.get("employerName", ""),
            "department": exp.get("department", ""),
            "title": exp.get("positionTitle", ""),
            "industry": exp.get("industry", ""),
            "startDate": exp.get("workStartDate", ""),
            "endDate": exp.get("workEndDate", ""),
            "city": exp.get("workPlace", ""),
            "summary": summary[:200] + ("..." if len(summary) > 200 else ""),
        })
    slim["workExp"] = slim_work
    
    # 项目经历（只取前 2 段，projSummary 截断 200 字）
    projects = resume.get("resumeProject", []) or []
    slim_proj = []
    for proj in projects[:2]:
        summary = proj.get("projSummary", proj.get("projectSummary", "")) or ""
        slim_proj.append({
            "name": proj.get("projectName", ""),
            "startDate": proj.get("projStartDate", proj.get("projectStartDate", "")),
            "endDate": proj.get("projEndDate", proj.get("projectEndDate", "")),
            "summary": summary[:200] + ("..." if len(summary) > 200 else ""),
        })
    slim["projects"] = slim_proj
    
    # 教育经历（全部保留）
    edu_list = resume.get("resumeEdu", []) or []
    slim_edu = []
    for edu in edu_list:
        slim_edu.append({
            "school": edu.get("eduSchool", edu.get("schoolName", "")),
            "degree": edu.get("eduLevel", edu.get("degree", "")),
            "major": edu.get("eduMajorName", edu.get("majorName", "")),
            "startDate": edu.get("eduStartDate", edu.get("startDate", "")),
            "endDate": edu.get("endDate", ""),
            "is985": edu.get("is985", False),
            "is211": edu.get("is211", False),
            "isC9": edu.get("isC9", False),
            "overSea": edu.get("overSea", False),
        })
    slim["education_list"] = slim_edu
    
    # 技能标签
    slim["skills"] = resume.get("resumeTagSkills", []) or []
    
    # 面试流程摘要（只取最近 1 条，用于风险判断）
    if flow_list:
        latest = flow_list[0]
        slim["latestFlow"] = {
            "postName": latest.get("postName", ""),
            "stateName": latest.get("stateName", ""),
            "updateTime": latest.get("lastUpdateTime", ""),
        }
    else:
        slim["latestFlow"] = None
    
    return slim


def main():
    parser = argparse.ArgumentParser(description="分批获取社招简历详情并过滤字段")
    parser.add_argument("--rids", required=True, help="逗号分隔的完整 rid 列表")
    parser.add_argument("--offset", type=int, default=0, help="起始位置（从第几个开始，默认 0）")
    parser.add_argument("--limit", type=int, default=5, help="本批数量（默认 5）")
    parser.add_argument("--rate-limit", type=int, default=5, help="频率控制：每多少个暂停 1 秒（默认 5）")
    args = parser.parse_args()
    
    all_rids = [r.strip() for r in args.rids.split(",") if r.strip()]
    if not all_rids:
        print(json.dumps({"error": "No valid rids provided", "results": [], "batch_info": {}}))
        return
    
    # 根据 offset 和 limit 截取本批 rids
    batch_rids = all_rids[args.offset : args.offset + args.limit]
    if not batch_rids:
        # v6.1.5: 空返回主动归因，避免模型把"offset 越界"误诊为"stdout 截断"
        warning = None
        if args.offset >= len(all_rids) and len(all_rids) > 0:
            warning = (
                f"offset={args.offset} 超出 --rids 总数 {len(all_rids)}。"
                f"常见原因：--rids 只传了本批的部分 rid。正确做法：每批都传全部 30 个 rid，"
                f"由 --offset/--limit 在脚本内切片。"
            )
        print(json.dumps({
            "results": [],
            "errors": [],
            "warning": warning,
            "batch_info": {
                "offset": args.offset,
                "limit": args.limit,
                "total_candidates": len(all_rids),
                "batch_count": 0,
                "has_more": False
            }
        }, ensure_ascii=False))
        return
    
    print(f"[deep_read] 分批拉取: offset={args.offset}, limit={args.limit}, 本批 {len(batch_rids)} 份", file=sys.stderr)
    
    client = MCPClient()
    results = []
    errors = []
    
    for i, rid in enumerate(batch_rids):
        try:
            global_idx = args.offset + i + 1
            print(f"  [{global_idx}/{len(all_rids)}] 获取 {rid[:8]}...", file=sys.stderr)
            raw = client.get_social_resume_detail(rid)
            slim = slim_detail(raw)
            results.append(slim)
        except Exception as e:
            print(f"  [error] {rid}: {e}", file=sys.stderr)
            errors.append({"rid": rid, "error": str(e)})
        
        # 频率控制
        if (i + 1) % args.rate_limit == 0 and i + 1 < len(batch_rids):
            print(f"  [pause] 已完成 {i+1} 个，暂停 1 秒...", file=sys.stderr)
            time.sleep(1)
    
    # 输出 JSON 到 stdout
    next_offset = args.offset + len(batch_rids)
    has_more = next_offset < len(all_rids)
    
    output = {
        "results": results, 
        "errors": errors, 
        "batch_info": {
            "offset": args.offset,
            "limit": args.limit,
            "total_candidates": len(all_rids),
            "batch_count": len(results),
            "next_offset": next_offset if has_more else None,
            "has_more": has_more
        }
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
