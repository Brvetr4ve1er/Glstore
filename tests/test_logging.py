"""Tests for the structured-logging module (Phase 9 Push 4).

We exercise the JsonFormatter directly rather than going through
setup_logging() so the test doesn't mutate the global root logger and
interfere with pytest's own capture.
"""
from __future__ import annotations

import asyncio
import json
import logging

import pytest

from api.core.logging import (
    JsonFormatter, bind_request_id, bound_request_id,
)


def _format(record: logging.LogRecord, *, component: str = "test") -> dict:
    return json.loads(JsonFormatter(component=component).format(record))


def _make_record(
    msg: str = "hello",
    level: int = logging.INFO,
    *,
    args: tuple = (),
    extra: dict | None = None,
) -> logging.LogRecord:
    rec = logging.LogRecord(
        name="glstore.test",
        level=level,
        pathname=__file__,
        lineno=1,
        msg=msg,
        args=args,
        exc_info=None,
    )
    if extra:
        for k, v in extra.items():
            setattr(rec, k, v)
    return rec


# ── Shape ──────────────────────────────────────────────────────────────────

def test_json_log_has_required_top_level_keys():
    out = _format(_make_record())
    for key in ("ts", "level", "logger", "component", "msg", "request_id"):
        assert key in out, f"missing top-level key {key!r}"


def test_json_log_renders_percent_format_message():
    rec = _make_record("scraped %d sources, %d prices", args=(6, 3))
    out = _format(rec)
    assert out["msg"] == "scraped 6 sources, 3 prices"


def test_json_log_promotes_extra_kwargs_to_top_level():
    rec = _make_record(extra={"job_id": "abc", "duration_ms": 1234})
    out = _format(rec)
    assert out["job_id"] == "abc"
    assert out["duration_ms"] == 1234


def test_json_log_does_not_leak_logrecord_internals():
    rec = _make_record(extra={"job_id": "x"})
    out = _format(rec)
    # These are LogRecord internals — they should never end up in output.
    for forbidden in ("args", "exc_info", "pathname", "filename", "module",
                      "funcName", "lineno", "msecs", "thread", "threadName",
                      "process", "processName", "created", "relativeCreated",
                      "exc_text", "stack_info"):
        assert forbidden not in out, f"unexpectedly leaked {forbidden!r}"


def test_json_log_serialises_unusual_value_types():
    """tuple/set/frozenset coerced to lists; bytes decoded; UUID via repr."""
    import uuid
    rec = _make_record(extra={
        "as_tuple":      ("a", "b"),
        "as_set":        {"x"},
        "as_frozenset":  frozenset({1, 2}),
        "as_bytes":      b"hello",
        "as_uuid":       uuid.UUID(int=0),
    })
    out = _format(rec)
    assert out["as_tuple"] == ["a", "b"]
    assert out["as_set"] == ["x"]
    assert sorted(out["as_frozenset"]) == [1, 2]
    assert out["as_bytes"] == "hello"
    # UUID falls through to default=str
    assert out["as_uuid"] == "00000000-0000-0000-0000-000000000000"


def test_json_log_attaches_exception_info():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        rec = logging.LogRecord(
            name="glstore.test", level=logging.ERROR, pathname=__file__,
            lineno=1, msg="failed", args=(), exc_info=sys.exc_info(),
        )
    out = _format(rec)
    assert out["exc_type"] == "ValueError"
    assert out["exc_message"] == "boom"
    assert "ValueError: boom" in out["exc_traceback"]


# ── Levels ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("level,name", [
    (logging.DEBUG,    "DEBUG"),
    (logging.INFO,     "INFO"),
    (logging.WARNING,  "WARNING"),
    (logging.ERROR,    "ERROR"),
    (logging.CRITICAL, "CRITICAL"),
])
def test_log_level_round_trip(level: int, name: str):
    rec = _make_record(level=level)
    out = _format(rec)
    assert out["level"] == name


# ── ContextVar plumbing ───────────────────────────────────────────────────

def test_request_id_is_null_when_unbound():
    bind_request_id(None)
    assert bound_request_id() is None
    out = _format(_make_record())
    assert out["request_id"] is None


def test_request_id_picked_up_from_contextvar():
    bind_request_id("rid-from-ctx")
    try:
        out = _format(_make_record())
        assert out["request_id"] == "rid-from-ctx"
    finally:
        bind_request_id(None)


def test_request_id_explicit_extra_wins_over_contextvar():
    """A handler that wants to override the ambient request_id (e.g. a
    worker logging the parent batch's id while a job-level rid is bound)
    should be able to do so via `extra={'request_id': ...}`."""
    bind_request_id("ambient")
    try:
        rec = _make_record(extra={"request_id": "explicit"})
        out = _format(rec)
        assert out["request_id"] == "explicit"
    finally:
        bind_request_id(None)


def test_request_id_propagates_into_async_child_tasks():
    """ContextVar copies into asyncio.Task on creation — every child
    coroutine spawned inside a request inherits the request_id without
    needing to thread it manually."""
    captured: list[str | None] = []

    async def child():
        captured.append(bound_request_id())

    async def main():
        bind_request_id("rid-parent")
        await asyncio.gather(child(), child())

    asyncio.run(main())
    assert captured == ["rid-parent", "rid-parent"]


# ── ts format ─────────────────────────────────────────────────────────────

def test_timestamp_is_iso_8601_utc_milliseconds():
    out = _format(_make_record())
    ts = out["ts"]
    # Examples of an acceptable shape: 2026-04-27T07:42:13.847Z
    assert ts.endswith("Z")
    assert "T" in ts
    # millisecond precision means 3 digits after the dot
    dot_split = ts.split(".")
    assert len(dot_split) == 2
    assert len(dot_split[1].rstrip("Z")) == 3
