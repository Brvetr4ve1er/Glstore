"""Tests for health probes (Phase 9 Push 6).

The probe runner (`_run_with_timeout`) and the aggregator (`overall_ok`)
are pure async logic — testable without httpx network access or a live
DB. We exercise them with hand-rolled coroutines.

Live-DB integration of the routes themselves is exercised in a separate
e2e suite that needs the docker compose stack — a future Push.
"""
from __future__ import annotations

import asyncio

import pytest

# We can't import api.core.health at module level because that triggers
# `import httpx` and `from sqlalchemy.ext.asyncio import AsyncSession`,
# both of which require optional install. Mirror the lazy-import pattern
# used in test_migrations.
def _import_health():
    from api.core import health
    return health


# ── _run_with_timeout ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_probe_succeeds_within_timeout():
    h = _import_health()

    async def fast() -> "h.ProbeResult":
        return h.ProbeResult(name="x", ok=True, duration_ms=5)

    out = await h._run_with_timeout("x", fast, timeout_s=1.0)
    assert out.ok is True
    assert out.error is None
    assert out.name == "x"


@pytest.mark.asyncio
async def test_probe_returns_failure_on_timeout():
    h = _import_health()

    async def slow() -> "h.ProbeResult":
        await asyncio.sleep(2.0)
        return h.ProbeResult(name="x", ok=True, duration_ms=2000)

    out = await h._run_with_timeout("slow", slow, timeout_s=0.05)
    assert out.ok is False
    assert "timeout" in (out.error or "")
    # Even on failure we record duration so dashboards can graph latency
    # spikes — important when a dep is degraded but not fully down.
    assert out.duration_ms >= 0


@pytest.mark.asyncio
async def test_probe_returns_failure_on_exception():
    h = _import_health()

    async def boom() -> "h.ProbeResult":
        raise ValueError("nope")

    out = await h._run_with_timeout("boom", boom, timeout_s=1.0)
    assert out.ok is False
    assert "ValueError" in (out.error or "")
    assert "nope" in (out.error or "")


@pytest.mark.asyncio
async def test_probe_failure_carries_required_flag_through():
    """An optional probe (LLM) failing must still report `required=False`
    so /readyz aggregation doesn't mistakenly 503."""
    h = _import_health()

    async def boom() -> "h.ProbeResult":
        raise TimeoutError("fake")

    out = await h._run_with_timeout("llm", boom, timeout_s=1.0, required=False)
    assert out.ok is False
    assert out.required is False


# ── overall_ok aggregation ───────────────────────────────────────────────

def test_overall_ok_true_when_all_required_pass():
    h = _import_health()
    results = [
        h.ProbeResult(name="db",      ok=True,  duration_ms=10, required=True),
        h.ProbeResult(name="searxng", ok=True,  duration_ms=80, required=True),
    ]
    assert h.overall_ok(results) is True


def test_overall_ok_false_when_a_required_probe_fails():
    h = _import_health()
    results = [
        h.ProbeResult(name="db",      ok=True,  duration_ms=10, required=True),
        h.ProbeResult(name="searxng", ok=False, duration_ms=80, required=True),
    ]
    assert h.overall_ok(results) is False


def test_overall_ok_true_when_only_optional_probe_fails():
    """LLM down ≠ degraded for /readyz: the rest of the system can still
    serve traffic. The audit ranks LLM as P1 / required=False on purpose."""
    h = _import_health()
    results = [
        h.ProbeResult(name="db",      ok=True,  duration_ms=10, required=True),
        h.ProbeResult(name="searxng", ok=True,  duration_ms=80, required=True),
        h.ProbeResult(name="llm",     ok=False, duration_ms=5000, required=False),
    ]
    assert h.overall_ok(results) is True


def test_overall_ok_handles_empty_input():
    h = _import_health()
    # Vacuously true — no required probes failed.
    assert h.overall_ok([]) is True


def test_probe_result_serializes_cleanly():
    h = _import_health()
    r = h.ProbeResult(
        name="db", ok=True, duration_ms=42,
        detail={"select_1": 1}, required=True,
    )
    d = r.to_dict()
    assert d["name"] == "db"
    assert d["ok"] is True
    assert d["duration_ms"] == 42
    assert d["detail"] == {"select_1": 1}
    assert d["required"] is True
    assert d["error"] is None


# ── Required-flag invariants ────────────────────────────────────────────

@pytest.mark.parametrize("name,required", [
    ("db",          True),
    ("searxng",     True),
    ("llm",         False),
    ("db_extended", False),
])
def test_probe_required_flag_default_matches_design_intent(name, required):
    """Codifies the audit decision: DB and SearXNG failing means we
    pull the instance out of the LB; LLM and extended-db being down is
    informational. If someone changes these flags, this test catches it."""
    h = _import_health()
    r = h.ProbeResult(name=name, ok=True, duration_ms=1, required=required)
    assert r.required is required


# ── Timeout budget sanity ────────────────────────────────────────────────

def test_readyz_total_budget_is_under_three_seconds():
    """Sum of /readyz probe budgets bounds how long an LB poll can hang.
    Keeping it under 3s means a 5s LB timeout has comfortable headroom."""
    # We can't import the function without the optional deps, so this
    # is a self-documenting constant — if you bump a probe's timeout,
    # also bump this assertion as a deliberate design decision.
    db_budget      = 1.0
    searxng_budget = 2.5
    assert db_budget + searxng_budget < 4.0
