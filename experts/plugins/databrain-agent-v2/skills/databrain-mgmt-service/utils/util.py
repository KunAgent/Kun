from __future__ import annotations
from datetime import datetime
import re
from loguru import logger
from typing import Dict, List

from utils.context import GameContext



def is_chinese_language(language: str | None) -> bool:
    """
    Determine whether the user's language setting indicates Chinese.
    Keep this logic consistent across prompt rules and tool output formatting.
    """
    if not language:
        return False
    return (
        "chinese" in language.lower()
        or language.lower().startswith("zh")
        or "中文" in language
    )
