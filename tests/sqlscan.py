"""Read SQL out of Python source, for the static store-scoping guards.

An f-string is ONE statement split into pieces around each `{...}`: scanning
the pieces separately sees `UPDATE applications SET ... {extra}` without the
`WHERE store_id = :sid` that follows the placeholder, and flags correct SQL.
So an f-string is reassembled (placeholders become `{}`) and checked whole,
and its pieces are not checked on their own.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path


def sql_strings(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    inside_fstrings: set[int] = set()
    out: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant) and isinstance(v.value, str):
                    inside_fstrings.add(id(v))
                    parts.append(v.value)
                else:
                    parts.append("{}")
            out.append("".join(parts))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in inside_fstrings:
            out.append(node.value)
    return [" ".join(s.split()) for s in out]


def statements_touching(path: Path, table: str) -> list[str]:
    rx = re.compile(rf"\b(FROM|INTO|UPDATE|JOIN)\s+{table}\b", re.I)
    return [s for s in sql_strings(path) if rx.search(s)]


def is_store_scoped(sql: str) -> bool:
    """Filtered by store (`store_id = :x`), or an INSERT that sets store_id."""
    return bool(
        re.search(r"store_id\s*=\s*:", sql, re.I)
        or re.search(r"\(\s*store_id\s*,", sql, re.I)
        or re.search(r"INSERT INTO \w+\s*\([^)]*\bstore_id\b", sql, re.I)
    )
