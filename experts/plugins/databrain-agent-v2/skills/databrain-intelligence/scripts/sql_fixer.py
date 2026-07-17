#!/usr/bin/env python3
"""
sql_fixer.py — SQL auto-repair loop (up to 3 retries).

Given an initial SQL and its execution error, generates repair prompts for an LLM
to produce a corrected SQL, retrying until success or the attempt limit is reached.

This module does NOT call any AI API. It outputs repair prompts for the caller to handle.
In an LLM agent loop the caller sends the prompt to the model, gets back a new SQL, and
passes it back into the loop.

Library usage:
    from sql_fixer import SqlFixer, FixResult

    fixer = SqlFixer(max_retries=3)
    result = fixer.run(initial_sql, execute_fn, schema_context)
    if result.success:
        print(result.final_sql)
    else:
        print(result.last_error)

CLI usage (print repair prompt):
    python sql_fixer.py --sql "SELECT * FROM t" \\
        --error "column x does not exist" \\
        --schema_context "t(id, name, date)"
"""

from __future__ import annotations

import argparse
import dataclasses
from typing import Callable, Optional


# ── Data structures ───────────────────────────────────────────────────────────

@dataclasses.dataclass
class FixAttempt:
    round: int           # attempt number (1-based)
    sql: str             # SQL used in this round
    error: str           # execution error message
    fix_prompt: str      # repair prompt generated


@dataclasses.dataclass
class FixResult:
    success: bool
    final_sql: str
    attempts: list[FixAttempt]    # repair history
    last_error: str = ""          # unresolved error (populated when success=False)


# ── Error classification ──────────────────────────────────────────────────────

_ERROR_HINTS: dict[str, str] = {
    "syntax error":  "Check SQL syntax: balanced parentheses, keyword spelling, comma placement, and quote pairs.",
    "column":        "Column not found: verify the column name exists in the schema; check case and table alias prefixes.",
    "table":         "Table not found: verify the full table name with schema prefix (e.g., intelligence.game_metric_sensortower_daily_uid).",
    "not found":     "Resource not found: ensure the schema.table path is correct and the game_code has access.",
    "group by":      "GROUP BY issue: every non-aggregated SELECT column must appear in GROUP BY.",
    "aggregate":     "Aggregation error: check SUM/COUNT/AVG usage; non-aggregated columns may be missing from GROUP BY.",
    "timeout":       "Query timeout: tighten the date range filter (date >= 'YYYY-MM-DD') to avoid full-table scans.",
    "date_trunc":    "BigQuery DATE_TRUNC syntax: DATE_TRUNC(dt, DAY) — argument order is (date, part), NOT ('day', dt).",
    "interval":      "BigQuery INTERVAL syntax: INTERVAL n DAY (no quotes needed, unlike PostgreSQL).",
    "qualify":       "QUALIFY is supported in BigQuery — use it to filter window function results directly.",
    "limit":         "SQL must end with a LIMIT clause (default 5000).",
    "security":      "Security check failed: only SELECT / WITH...SELECT is allowed.",
    "permission":    "No permission: verify game_code and database_uuid are correct.",
    "schema":        "Schema prefix required in BigQuery: use schema.table_name, never a bare table name.",
}


def _classify_error(error_msg: str) -> str:
    """Return targeted diagnostic hints based on the error message."""
    lower = error_msg.lower()
    hints = [hint for key, hint in _ERROR_HINTS.items() if key in lower]
    return "\n".join(hints) if hints else "Review SQL syntax and column names carefully."


# ── Repair prompt builder ─────────────────────────────────────────────────────

def build_fix_prompt(
    sql: str,
    error: str,
    schema_context: str = "",
    dialect_hint: str = "",
    attempt_round: int = 1,
) -> str:
    """
    Build a SQL repair prompt ready to send to an LLM.

    Args:
        sql: The SQL that failed execution.
        error: The error message returned by the engine.
        schema_context: Relevant table schema (reduces hallucination). Optional.
        dialect_hint: Database dialect rules. Optional.
        attempt_round: Which repair attempt this is (1-based, informational).

    Returns:
        A complete repair prompt string.
    """
    error_hint = _classify_error(error)

    parts = [
        f"Fix the SQL below so it executes correctly (attempt {attempt_round}).",
        "",
        "<failed_sql>",
        sql.strip(),
        "</failed_sql>",
        "",
        "<error>",
        error.strip(),
        "</error>",
        "",
        "<diagnosis>",
        error_hint,
        "</diagnosis>",
    ]

    if schema_context:
        parts += [
            "",
            "<schema>",
            schema_context.strip(),
            "</schema>",
        ]

    if dialect_hint:
        parts += [
            "",
            "<dialect>",
            dialect_hint.strip(),
            "</dialect>",
        ]

    parts += [
        "",
        "Output only the fixed SQL.",
        "Do not explain. Do not wrap in markdown fences.",
        "Preserve the original query intent — change only what caused the error.",
        "Use SELECT / WITH...SELECT only. End with LIMIT.",
    ]

    return "\n".join(parts)


# ── SqlFixer: auto-repair loop controller ────────────────────────────────────

class SqlFixer:
    """
    SQL auto-repair loop controller.

    Decoupled from LLM calls: the caller supplies ai_fix_fn (prompt → SQL).

    Example:
        def my_ai_fn(prompt: str) -> str:
            return ai_client.complete(prompt)

        fixer = SqlFixer(max_retries=3, ai_fix_fn=my_ai_fn)
        result = fixer.run(sql, execute_fn, schema_context)
    """

    def __init__(
        self,
        max_retries: int = 3,
        ai_fix_fn: Optional[Callable[[str], str]] = None,
    ):
        """
        Args:
            max_retries: Maximum number of repair attempts (not counting the initial run).
            ai_fix_fn: Callable that takes a repair prompt and returns a fixed SQL string.
                       When None, the loop stops after the first failure and exposes the prompt.
        """
        self.max_retries = max_retries
        self.ai_fix_fn = ai_fix_fn

    def run(
        self,
        initial_sql: str,
        execute_fn: Callable[[str], tuple[bool, str]],
        schema_context: str = "",
        dialect_hint: str = "",
    ) -> FixResult:
        """
        Execute SQL and repair on error, up to max_retries times.

        Args:
            initial_sql: The SQL to execute first.
            execute_fn: Callable(sql) → (success: bool, error_or_result: str).
            schema_context: Table schema injected into repair prompts.
            dialect_hint: SQL dialect rules injected into repair prompts.

        Returns:
            FixResult with success flag, final SQL, and attempt history.
        """
        sql = initial_sql.strip()
        attempts: list[FixAttempt] = []

        for attempt in range(self.max_retries + 1):
            success, message = execute_fn(sql)
            if success:
                return FixResult(success=True, final_sql=sql, attempts=attempts)

            if attempt >= self.max_retries:
                break

            prompt = build_fix_prompt(
                sql=sql,
                error=message,
                schema_context=schema_context,
                dialect_hint=dialect_hint,
                attempt_round=attempt + 1,
            )
            attempts.append(FixAttempt(
                round=attempt + 1,
                sql=sql,
                error=message,
                fix_prompt=prompt,
            ))

            if self.ai_fix_fn is None:
                # No AI function: stop and expose the prompt for external handling
                return FixResult(
                    success=False,
                    final_sql=sql,
                    attempts=attempts,
                    last_error=f"[no ai_fix_fn] Repair prompt generated:\n{prompt}",
                )

            fixed_sql = _strip_markdown_sql(self.ai_fix_fn(prompt).strip())
            sql = fixed_sql

        return FixResult(
            success=False,
            final_sql=sql,
            attempts=attempts,
            last_error=attempts[-1].error if attempts else "Unknown error",
        )


def _strip_markdown_sql(text: str) -> str:
    """Strip ```sql ... ``` fences that an LLM may wrap around SQL output."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        inner = lines[1:] if len(lines) > 1 else lines
        if inner and inner[-1].strip() == "```":
            inner = inner[:-1]
        text = "\n".join(inner).strip()
    return text


# ── CLI entry point (debug: print repair prompt) ─────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Print a SQL repair prompt (debug).")
    parser.add_argument("--sql",            required=True,  help="The failed SQL")
    parser.add_argument("--error",          required=True,  help="Execution error message")
    parser.add_argument("--schema_context", default="",     help="Table schema context")
    parser.add_argument("--dialect_hint",   default="",     help="SQL dialect hint")
    parser.add_argument("--round",          type=int, default=1, help="Attempt number")
    args = parser.parse_args()

    prompt = build_fix_prompt(
        sql=args.sql,
        error=args.error,
        schema_context=args.schema_context,
        dialect_hint=args.dialect_hint,
        attempt_round=args.round,
    )
    print(prompt)


if __name__ == "__main__":
    main()
