"""Stub: common.cls — log_metrics via loguru."""
from loguru import logger


def log_metrics(name: str, status_code: str, latency_ms: float):
    logger.info("METRIC name={} status={} latency_ms={}", name, status_code, latency_ms)
