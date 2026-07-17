"""远端结论协议解析器（spec §5.3）。

严格解析 [结论]/[结果信息] 双行结构，任何不符合 → ("malformed", answer)
"""
import re
from typing import Tuple

CONCLUSION_VALUES: Tuple[str, ...] = ("成功", "失败", "异常", "待确认")

_CONCLUSION_LINE = re.compile(
    r"^\s*\[结论\]\s*[:：]?\s*(\S+)\s*$", re.MULTILINE
)
_RESULT_INFO_LINE = re.compile(
    r"^\s*\[结果信息\]\s*[:：]?\s*", re.MULTILINE
)
_PRICE_LINE = re.compile(
    r"^\s*\[价格\]\s*[:：]?\s*", re.MULTILINE
)
_FOUR_LAYER_LINE = re.compile(
    r"^\s*\[四层\]\s*[:：]?\s*", re.MULTILINE
)


def parse_conclusion(answer: str) -> Tuple[str, str]:
    """返回 (conclusion, result_info)。

    - conclusion 合法（4 枚举）：
        * 有 [结果信息] 行：result_info = [结果信息] 行之后到 [价格]/[四层] 段之前
          的所有内容（strip 首尾空白）—— 严格协议路径
        * 无 [结果信息] 行：result_info = [结论] 行之后到 [价格]/[四层] 段之前
          的所有内容（strip）—— 宽松路径（2026-06-22 修订，方案 B）
          这避免了远端返回 `[结论] 待确认` 但用大段 markdown 代替 `[结果信息]:` 标签
          时被误判为 malformed → 异常重试 → failed 的问题
    - [结论] 不合法或缺失：返回 ("malformed", answer)

    [价格] / [四层] 段（若有）按最先出现者截断 result_info，价格交由 parse_price、
    四层编码交由 parse_four_layer 单独原样提取。
    """
    if not answer:
        return "malformed", answer

    m_concl = _CONCLUSION_LINE.search(answer)
    if not m_concl:
        return "malformed", answer
    value = m_concl.group(1)
    if value not in CONCLUSION_VALUES:
        return "malformed", answer

    m_info = _RESULT_INFO_LINE.search(answer)
    # 决定 info 起点（2026-06-22 修订，方案 B）：
    # - 严格路径：找到 [结果信息] 行 且 在 [结论] 之后 → info_start = [结果信息] 行末
    # - 宽松路径：完全没有 [结果信息] 行 → info_start = [结论] 行末
    # - 仍判 malformed：有 [结果信息] 行 但顺序错（出现在 [结论] 之前）
    if m_info is None:
        # 宽松：完全没有 [结果信息] 行 → 把 [结论] 之后的内容当 result_info
        info_start = m_concl.end()
    elif m_info.start() < m_concl.start():
        # 顺序错（[结果信息] 在 [结论] 之前）→ 严格判 malformed，保持原契约
        return "malformed", answer
    else:
        info_start = m_info.end()

    # [价格] / [四层] 段（若有）必须出现在 info_start 之后；按最先出现者截断
    # result_info，避免结构化段污染。两段都没有时行为与旧版完全一致。
    cut = len(answer)
    m_price = _PRICE_LINE.search(answer, info_start)
    if m_price:
        cut = min(cut, m_price.start())
    m_four = _FOUR_LAYER_LINE.search(answer, info_start)
    if m_four:
        cut = min(cut, m_four.start())
    info = answer[info_start:cut].strip()
    return value, info


def parse_price(answer: str) -> str:
    """原样提取 [价格] 段内容（[价格] 行之后到回复结尾或 [四层] 段之前）；
    无 [价格] 段则返回 ""。

    纯字符级搬运：不解析数字、不拆字段、不换算、不校验格式。价格的值与单位
    完全以远端 LLM 返回为准（SKILL.md 铁律 6 改造版）。
    """
    if not answer:
        return ""
    m = _PRICE_LINE.search(answer)
    if not m:
        return ""
    end = len(answer)
    # [四层] 段约定排在 [价格] 之后；据此截断，避免四层编码卷进价格段。
    m_four = _FOUR_LAYER_LINE.search(answer, m.end())
    if m_four:
        end = m_four.start()
    return answer[m.end():end].strip()


def parse_four_layer(answer: str) -> str:
    """原样提取 [四层] 段内容（[四层] 行之后到回复结尾）；无 [四层] 段则返回 ""。

    纯字符级搬运：不解析、不补全、不翻译、不猜测。腾讯云四层商品编码完全以远端
    刊例价助手返回为准，仅供 CPQ 选品（C 段）复用，本地零加工（铁律 6 同源约束）。
    """
    if not answer:
        return ""
    m = _FOUR_LAYER_LINE.search(answer)
    if not m:
        return ""
    return answer[m.end():].strip()
