#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
match_model.py — 按候选人投递岗位/BG/招聘类型自动匹配最佳胜任力模型 + 面试方案

【v2 · 远程资产版】
本脚本不再扫描本地 references/models/*.md（这些已 stub 化，不再含原文），
改为读取 references/_remote-assets.yaml 按 `match` 字段做条件匹配，
输出语义键 + documentId，由上层 agent 调 MCP get_document 拉正文。

用法：
    python3 match_model.py <resume_raw.json>

输出（JSON 到 stdout）：
    {
      "triple": {"bg": "wxg", "station": "backend", "recruit_type": "campus", "round": "tech1"},
      "model": {
        "asset_key": "model_wxg_backend",
        "document_id": 18,
        "source": "auto-matched",
        "score": 100,
        "warning": null
      },
      "design": {
        "asset_key": "design_wxg_backend_tech1",
        "document_id": 12,
        "source": "auto-matched",
        "score": 100,
        "warning": null
      },
      "overlays": [
        {"asset_key": "qizhi_wxg", "document_id": 14, "reason": "BG=WXG 自动叠加"}
      ]
    }

退出码：
    0 = 成功（即使降级也算成功）
    1 = 简历解析失败 / 三元组提取失败
    2 = 兜底语义键也未在 yaml 中找到（严重）
"""
import json
import os
import re
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
ASSETS_FILE = SKILL_ROOT / "references" / "_remote-assets.yaml"
ALIAS_FILE = SKILL_ROOT / "references" / "models" / "_station_alias.json"


# ---------------------------------------------------------------------------
# 0. _remote-assets.yaml 读取（不引入 PyYAML，用最小解析）
# ---------------------------------------------------------------------------

def load_assets() -> dict:
    """
    读取 _remote-assets.yaml 中的 assets 节，返回 {key: {id, match, ...}}。
    简化的手写解析，只支持本项目实际使用的 yaml 子集（避免引入 PyYAML 依赖）。
    """
    if not ASSETS_FILE.exists():
        raise FileNotFoundError(f"找不到资产索引: {ASSETS_FILE}")

    text = ASSETS_FILE.read_text(encoding="utf-8")
    # 去掉注释行
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or not stripped:
            lines.append("")
            continue
        # 行尾注释
        if "#" in line and ":" in line:
            # 简单处理：忽略行尾注释（仅当 # 前是空格时）
            idx = line.find("#")
            if idx > 0 and line[idx - 1] in (" ", "\t"):
                line = line[:idx].rstrip()
        lines.append(line)

    assets: dict = {}
    in_assets = False
    cur_key = None
    cur_obj: dict = {}

    def commit():
        nonlocal cur_key, cur_obj
        if cur_key:
            assets[cur_key] = cur_obj
        cur_key = None
        cur_obj = {}

    for raw in lines:
        if not raw.strip():
            continue
        if raw.startswith("assets:"):
            in_assets = True
            continue
        if not in_assets:
            continue
        # 资产键（顶级 2 空格缩进，行尾 :）
        m = re.match(r"^  ([A-Za-z_][A-Za-z0-9_]*):\s*$", raw)
        if m:
            commit()
            cur_key = m.group(1)
            cur_obj = {"key": cur_key}
            continue
        # 字段（4 空格缩进）
        m = re.match(r"^    ([a-z_]+):\s*(.*?)\s*$", raw)
        if m and cur_key:
            field, value = m.group(1), m.group(2)
            if value.startswith("{") and value.endswith("}"):
                # 内联 dict: { bg: WXG, position_family: backend }
                inner = value[1:-1]
                obj = {}
                for part in inner.split(","):
                    if ":" in part:
                        k, v = part.split(":", 1)
                        obj[k.strip()] = v.strip()
                cur_obj[field] = obj
            elif value.startswith("[") and value.endswith("]"):
                inner = value[1:-1]
                cur_obj[field] = [x.strip() for x in inner.split(",") if x.strip()]
            elif value.isdigit():
                cur_obj[field] = int(value)
            else:
                cur_obj[field] = value
            continue
        # 顶级新键 → 退出 assets 节
        if re.match(r"^[A-Za-z]", raw):
            commit()
            in_assets = False
    commit()
    return assets


# ---------------------------------------------------------------------------
# 1. 简历三元组提取（与 v1 相同）
# ---------------------------------------------------------------------------

def extract_triple(raw_path: str) -> dict:
    with open(raw_path, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("简历 JSON 解析失败：未找到 JSON 对象")

    data = json.loads(m.group(0))
    payload = data.get("data", {}).get("data", {})
    if isinstance(payload, dict) and "data" in payload and "resumeInfo" not in payload:
        payload = payload.get("data") or {}

    info = payload.get("resumeInfo") or {}
    records = ((payload.get("interviewRecords") or {}).get("list")) or []

    bg_txt = ""
    if records:
        bg_txt = records[0].get("bg_txt") or records[0].get("bgTxt") or ""
    if not bg_txt:
        bg_txt = info.get("intentBgTxt") or info.get("bgTxt") or ""

    station_txt = info.get("stationTxt") or info.get("station_txt") or ""
    recruit_project = info.get("recruitProject", 1)
    recruit_type_map = {1: "campus", 2: "intern", 3: "social"}
    recruit_type = recruit_type_map.get(recruit_project, "campus")

    current_interviewer = ""
    current_step = ""
    if records:
        current_interviewer = records[0].get("current_staff_txt", "")
        for f in records[0].get("flows") or []:
            staff = f.get("staff_txt", "")
            if current_interviewer and current_interviewer in staff:
                current_step = f.get("step_txt", "")
                break

    return {
        "bg_txt": bg_txt,
        "station_txt": station_txt,
        "recruit_type": recruit_type,
        "current_interviewer": current_interviewer,
        "current_step": current_step,
    }


# ---------------------------------------------------------------------------
# 2. 字段标准化（中文 → 标准 code）
# ---------------------------------------------------------------------------

BG_ALIAS = {
    "wxg": "WXG", "微信": "WXG", "微信事业群": "WXG", "wechat": "WXG",
    "ieg": "IEG", "互娱": "IEG", "互动娱乐": "IEG",
    "pcg": "PCG", "平台与内容": "PCG",
    "csig": "CSIG", "云与智慧产业": "CSIG", "云": "CSIG",
    "teg": "TEG", "技术工程": "TEG",
    "cdg": "CDG", "企业发展": "CDG",
    # S1 职能系统：必须排在通用 "职能"->S3 之前，
    # 否则 "S1职能系统" 含子串 "职能" 会被先命中误判为 S3
    "s1职能系统": "S1", "职能系统": "S1", "s1": "S1",
    "s3": "S3", "职能": "S3", "hr": "S3",
}

STEP_ALIAS = {
    "HR面试": "hr", "HR面": "hr", "hr面": "hr",
    "初试": "tech1", "业务一面": "tech1", "一面": "tech1", "AI初面": "tech1",
    "复试": "tech2", "业务二面": "tech2", "二面": "tech2",
    "终面": "final", "GM面": "final", "HRD面": "final",
}


def load_station_alias() -> dict:
    if ALIAS_FILE.exists():
        try:
            return json.loads(ALIAS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "后台开发": "backend", "后端开发": "backend", "服务端": "backend", "服务端开发": "backend",
        "前端开发": "frontend", "Web 前端": "frontend",
        "客户端开发": "client", "iOS": "ios", "Android": "android",
        "游戏策划": "gameplan", "系统策划": "gameplan", "数值策划": "gameplan",
        "用户研究": "userresearch", "用研": "userresearch",
        "产品经理": "productmgr", "产品策划": "productmgr",
        "运营": "operation", "测试": "qa", "测试开发": "qa",
        "数据分析": "dataanalyst",
        "算法": "algo", "机器学习": "algo", "AI 研究员": "ai-researcher",
        "HR": "hr", "招聘": "recruiter",
    }


def normalize_bg(bg_txt: str) -> str:
    s = (bg_txt or "").lower().strip()
    if not s:
        return "GROUP"
    for key, code in BG_ALIAS.items():
        if key in s or key in (bg_txt or ""):
            return code
    return "GROUP"


def normalize_station(station_txt: str, alias: dict) -> str:
    if not station_txt:
        return "all"
    if station_txt in alias:
        return alias[station_txt]
    for key, code in alias.items():
        if key in station_txt:
            return code
    return "all"


def normalize_round(step_txt: str) -> str:
    return STEP_ALIAS.get((step_txt or "").strip(), "")


# ---------------------------------------------------------------------------
# 3. 资产匹配（按 yaml 中 match 字段）
# ---------------------------------------------------------------------------

def match_score(triple: dict, m: dict) -> int:
    """
    triple = {bg, position_family, recruit_type, round}
    m      = asset["match"]
    返回匹配分数；越多字段命中越高，全不命中返回 0
    """
    if not m:
        return 0
    score = 0
    for k in ("bg", "position_family", "recruit_type", "step"):
        if k in m:
            v = m[k]
            tv = triple.get(k)
            if not tv:
                return 0  # 必匹配字段缺失
            # 大小写宽容
            if str(v).lower() == str(tv).lower():
                score += 1
            else:
                return 0  # 任一字段不匹配整体不算
    return score


def find_model(assets: dict, triple: dict) -> dict | None:
    """
    匹配主模型（type 看起来像 model_*）。
    优先精确（bg+岗位族+招聘类型），降级到 BG 级，最后到 default。
    """
    candidates = []
    for key, asset in assets.items():
        if not key.startswith("model_"):
            continue
        m = asset.get("match") or {}
        s = match_score(triple, m)
        if s > 0:
            candidates.append((s, key, asset))

    candidates.sort(key=lambda x: -x[0])

    if candidates:
        s, key, asset = candidates[0]
        # 命中 model_default_social 是社招兜底的正常路径，给专属 warning
        if key == "model_default_social":
            warning = "社招暂无岗位级专属模型，使用集团公司价值观兜底（v4.5 临时方案，业务方提供社招岗位模型后再细分）"
        else:
            warning = None if s >= 2 else "按 BG 模糊匹配，建议补建岗位专属模型"
        return {
            "asset_key": key,
            "document_id": asset.get("id"),
            "source": "auto-matched" if s >= 2 else "bg-fallback",
            "score": min(100, 50 + s * 25),
            "warning": warning,
        }

    # 全降级到 default（按招聘类型分发兜底键）
    recruit_type = triple.get("recruit_type", "campus")
    if recruit_type == "social":
        default_key = "model_default_social"
        warning_msg = "社招暂无岗位级专属模型，降级到集团公司价值观兜底（v4.5 临时方案）"
    else:
        default_key = "model_default_campus"
        warning_msg = "未找到任何匹配的 BG/岗位模型，降级到集团校招通用兜底"
    default = assets.get(default_key)
    if default:
        return {
            "asset_key": default_key,
            "document_id": default.get("id"),
            "source": "global-fallback",
            "score": 20,
            "warning": warning_msg,
        }
    return None


def find_design(assets: dict, triple: dict) -> dict | None:
    """匹配本轮面试设计方案"""
    candidates = []
    for key, asset in assets.items():
        if not key.startswith("design_"):
            continue
        m = asset.get("match") or {}
        s = match_score(triple, m)
        if s > 0:
            candidates.append((s, key, asset))

    candidates.sort(key=lambda x: -x[0])

    if candidates:
        s, key, asset = candidates[0]
        return {
            "asset_key": key,
            "document_id": asset.get("id"),
            "source": "auto-matched" if s >= 3 else "round-fallback",
            "score": min(100, 30 + s * 20),
            "warning": None if s >= 3 else "未找到岗位+本轮的精确方案，使用近似方案",
        }

    fallback = assets.get("flow_matrix_campus_fallback")
    if fallback:
        return {
            "asset_key": "flow_matrix_campus_fallback",
            "document_id": fallback.get("id"),
            "source": "global-fallback",
            "score": 10,
            "warning": "未找到 BG/岗位面试设计方案，降级到集团通用流程矩阵",
        }
    return None


def find_overlays(assets: dict, triple: dict) -> list:
    """
    叠加资产（红线、气质等），多个可能同时叠加。
    匹配规则：asset 不以 model_ / design_ / flow_ / scoring_ / risk_ / bg_ 开头，
    且 match 字段的 bg/recruit_type 等命中。
    """
    overlays = []
    for key, asset in assets.items():
        # 主模型/设计/流程矩阵不算 overlay
        if key.startswith(("model_", "design_", "flow_matrix_", "scoring_", "risk_", "bg_context")):
            continue
        m = asset.get("match")
        if not m:
            continue
        s = match_score(triple, m)
        if s > 0:
            overlays.append({
                "asset_key": key,
                "document_id": asset.get("id"),
                "reason": f"匹配 {','.join(f'{k}={v}' for k,v in m.items())}",
            })
    return overlays


# ---------------------------------------------------------------------------
# 4. 主流程
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: match_model.py <resume_raw.json>", file=sys.stderr)
        sys.exit(1)

    raw_path = sys.argv[1]
    if not os.path.exists(raw_path):
        print(f"❌ 简历文件不存在: {raw_path}", file=sys.stderr)
        sys.exit(1)

    try:
        triple_raw = extract_triple(raw_path)
    except Exception as e:
        print(f"❌ 简历三元组提取失败: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        assets = load_assets()
    except Exception as e:
        print(f"❌ 资产索引读取失败: {e}", file=sys.stderr)
        sys.exit(2)

    alias = load_station_alias()
    bg = normalize_bg(triple_raw["bg_txt"])
    station = normalize_station(triple_raw["station_txt"], alias)
    recruit_type = triple_raw["recruit_type"]
    round_ = normalize_round(triple_raw["current_step"])

    triple = {
        "bg": bg,
        "position_family": station,
        "recruit_type": recruit_type,
        "step": round_,
    }

    model = find_model(assets, triple)
    design = find_design(assets, triple)
    overlays = find_overlays(assets, triple)

    if model is None:
        print("❌ 严重错误：连兜底模型也未在 _remote-assets.yaml 中找到", file=sys.stderr)
        sys.exit(2)

    result = {
        "triple": {
            "bg": bg,
            "bg_txt": triple_raw["bg_txt"],
            "station": station,
            "station_txt": triple_raw["station_txt"],
            "recruit_type": recruit_type,
            "round": round_,
            "current_step": triple_raw["current_step"],
            "current_interviewer": triple_raw["current_interviewer"],
        },
        "model": model,
        "design": design,
        "overlays": overlays,
        "_note": "上游 agent 拿到 asset_key + document_id 后，调 MCP "
                 "recruit.recruit-ai-service.get_document 拉正文，命中会话级缓存。",
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
