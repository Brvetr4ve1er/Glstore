"""A scripted stand-in for an AsyncSession, for driving real routes over HTTP
without Postgres.

It answers SQL by regex and records every statement with its parameters, so a
test can assert what a route ASKED the database (which store id, which price,
which hash) and control what it was told. It cannot prove the SQL is correct —
only Postgres can — which is why the static guards exist alongside it.
"""
from __future__ import annotations

import re


class Row(tuple):
    """What SQLAlchemy hands back: index access AND attribute access."""

    def __new__(cls, **cols):
        row = super().__new__(cls, cols.values())
        row.__dict__.update(cols)
        return row


class Result:
    def __init__(self, rows=(), scalar=0):
        self._rows = list(rows)
        self._scalar = scalar

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._scalar


class FakeSession:
    """Answers SQL by pattern (first match wins). Unmatched SQL gets no rows."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.commits = 0
        self.rollbacks = 0
        self._handlers: list[tuple[re.Pattern, object]] = []

    def on(self, pattern: str, answer) -> "FakeSession":
        self._handlers.append((re.compile(pattern, re.I | re.S), answer))
        return self

    async def execute(self, clause, params=None):
        sql = " ".join(str(clause).split())
        params = dict(params or {})
        self.calls.append((sql, params))
        for pat, answer in self._handlers:
            if pat.search(sql):
                return answer(params) if callable(answer) else answer
        return Result()

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    def statements(self, pattern: str) -> list[dict]:
        rx = re.compile(pattern, re.I | re.S)
        return [p for s, p in self.calls if rx.search(s)]

    def sql(self, pattern: str) -> list[str]:
        rx = re.compile(pattern, re.I | re.S)
        return [s for s, _ in self.calls if rx.search(s)]
