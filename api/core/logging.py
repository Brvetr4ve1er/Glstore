"""
Structured logging — Phase 9 Push 4.

One canonical log line shape for every Python process in the stack (API +
4 workers). Lines are JSON, one per line, written to stdout where Docker
collects them. From there they can be shipped to anywhere — Loki, Datadog,
Sentry, Splunk, OpenSearch — without code changes.

Public API:
    setup_logging(component: str, level: int = logging.INFO) -> None
        Idempotent. Replaces the root logger's handlers with a single
        JsonFormatter-wrapped StreamHandler. Tags every record with the
        component name (e.g. "api", "intel-worker"). Call once per process.

    bind_request_id(request_id: str) -> None
        Sets the request_id ContextVar. The formatter picks it up
        automatically — no need to pass `extra={"request_id": ...}`.

    bound_request_id() -> str | None
        Read the current request_id from the ContextVar (handy for
        attaching it to outbound HTTP headers, error envelopes, etc.).

Why ContextVar instead of `extra={"request_id": ...}` everywhere:
    - asyncio.Task copies the parent's context, so a request_id set in
      middleware automatically flows into every coroutine spawned during
      the request — DB queries, fan-out fetches, gather() calls, etc.
    - The 21 existing `log.info()` calls in the codebase don't need to
      thread a request_id parameter through 5 levels of helpers; the
      formatter pulls it from the active context.
    - When a log call DOES use `extra={...}`, those fields land alongside
      the request_id under a flat top level — both are first-class.

Output shape (one JSON object per line):
    {
      "ts": "2026-04-27T07:42:13.847Z",
      "level": "INFO",
      "logger": "glstore.intel",
      "component": "api",
      "msg": "intel job claimed",
      "request_id": "abc123def4567890",   # may be null
      "job_id": "...", "product_id": "...", ...   # any extra= kwargs
    }
"""
from __future__ import annotations

import json
import logging
import os
import sys
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any


# ── ContextVar: request_id flows automatically through asyncio tasks ───────

_request_id_var: ContextVar[str | None] = ContextVar("gl_request_id", default=None)


def bind_request_id(rid: str | None) -> None:
    """Attach a request_id to the current async context. Subsequent log
    calls (from this task or any child task spawned within the same
    context) carry it without needing `extra={'request_id': ...}`."""
    _request_id_var.set(rid)


def bound_request_id() -> str | None:
    """Read whatever request_id is bound for the current context, or None
    if we're outside any request (e.g. on a worker tick or app startup)."""
    return _request_id_var.get()


# ── JSON formatter ────────────────────────────────────────────────────────

# LogRecord fields we never want to serialize as "extras" because they're
# either redundant (msg, args, levelname) or would leak Python internals.
_RESERVED_RECORD_KEYS: frozenset[str] = frozenset({
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
    # Our own injected fields — handled explicitly below
    "component",
})


class JsonFormatter(logging.Formatter):
    """Formats a LogRecord as a single JSON object. Picks up the
    request_id from the ContextVar so callers don't have to."""

    def __init__(self, *, component: str) -> None:
        super().__init__()
        self._component = component

    def format(self, record: logging.LogRecord) -> str:
        # Render the message — handles both plain strings and `%`-style.
        try:
            message = record.getMessage()
        except Exception:
            # Don't let a broken format string nuke the log line.
            message = str(record.msg)

        out: dict[str, Any] = {
            "ts":        datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level":     record.levelname,
            "logger":    record.name,
            "component": self._component,
            "msg":       message,
        }

        # request_id: prefer an explicit `extra={"request_id": ...}` (so
        # background workers tagging a job_id can override), then fall
        # back to the ContextVar.
        rid = getattr(record, "request_id", None) or _request_id_var.get()
        out["request_id"] = rid

        # Any other LogRecord attribute that wasn't there at construction
        # time was contributed by the caller's `extra=` kwarg — promote it.
        for key, val in record.__dict__.items():
            if key in _RESERVED_RECORD_KEYS or key == "request_id":
                continue
            # logging itself sometimes adds private-looking attrs (_*) — skip.
            if key.startswith("_"):
                continue
            try:
                out[key] = _safe_json_value(val)
            except Exception:
                out[key] = repr(val)

        # Exceptions: serialize the traceback under a stable key.
        if record.exc_info:
            out["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            out["exc_message"] = str(record.exc_info[1]) if record.exc_info[1] else None
            out["exc_traceback"] = "".join(traceback.format_exception(*record.exc_info)).rstrip()
        elif record.exc_text:  # pre-formatted (rare)
            out["exc_traceback"] = record.exc_text

        # `default=str` is a safety net so anything not natively
        # serialisable (UUID, datetime, set, ...) renders as its repr
        # rather than crashing the log call.
        return json.dumps(out, ensure_ascii=False, default=str, separators=(",", ":"))


def _safe_json_value(val: Any) -> Any:
    """Make a value JSON-friendly without losing useful information.
    Tuples, sets, frozensets become lists; bytes become utf-8 strings."""
    if isinstance(val, (str, int, float, bool)) or val is None:
        return val
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, (tuple, set, frozenset)):
        return list(val)
    if isinstance(val, bytes):
        try:
            return val.decode("utf-8", errors="replace")
        except Exception:
            return repr(val)
    return val   # let json.dumps' default=str handle the rest


# ── Setup ─────────────────────────────────────────────────────────────────

_already_setup = False


def setup_logging(component: str, *, level: int | None = None) -> None:
    """Install the JSON formatter on the root logger. Idempotent — calling
    it twice is a no-op so we don't end up with duplicate handlers if
    something imports us in a circular path.

    Reads `GL_LOG_LEVEL` from the environment as an override (DEBUG/INFO/
    WARNING/ERROR). Defaults to INFO. The `level` arg wins if both are set.
    """
    global _already_setup
    if _already_setup:
        return

    if level is None:
        env_level = os.environ.get("GL_LOG_LEVEL", "INFO").upper()
        level = getattr(logging, env_level, logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(component=component))

    root = logging.getLogger()
    # Wipe any handlers a previous call to logging.basicConfig() (or a
    # library doing the same) added. Otherwise we'd double-log every line.
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    root.setLevel(level)

    # Quiet down a few noisy third-parties at INFO level (they still
    # surface at WARNING+). `sqlalchemy.engine` in particular emits one
    # INFO record per SQL statement when echo is enabled — we'd rather
    # explicitly opt in via GL_LOG_LEVEL=DEBUG when tracing queries.
    for noisy in ("uvicorn.access", "uvicorn.error", "httpx",
                  "httpcore", "asyncio", "watchfiles",
                  "sqlalchemy.engine", "sqlalchemy.engine.Engine",
                  "sqlalchemy.pool"):
        logging.getLogger(noisy).setLevel(max(level, logging.WARNING))

    _already_setup = True
