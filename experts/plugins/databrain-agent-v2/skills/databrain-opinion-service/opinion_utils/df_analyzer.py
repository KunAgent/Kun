"""Stub: utils.df_analyzer — no-op in react agent (agent has built-in analysis)."""
from loguru import logger


class DataFrameAnalyzer:
    """No-op analyzer. React agent handles analysis natively."""
    def __init__(self, *args, **kwargs):
        pass

    def analyze(self, *args, **kwargs):
        return {}

    def describe(self, *args, **kwargs):
        return ""

    def get_summary(self, *args, **kwargs):
        return ""
