"""
Settings endpoints — Phase 4 + Phase 9.

GET  /settings/llm        → current LLM config (api_key masked)
PUT  /settings/llm        → update LLM config (admin only)
POST /settings/llm/ping   → online + available models
GET  /settings/theme      → current admin theme config (preset + overrides)
PUT  /settings/theme      → update theme (admin only)
"""
from __future__ import annotations

import json
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.db import get_db
from api.core.security import require_role
from api.services import llm

router = APIRouter(prefix="/settings", tags=["settings"])

WRITE_ROLES = ("SUPER_ADMIN", "ADMIN")
READ_ROLES = ("SUPER_ADMIN", "ADMIN", "OPERATOR")


class LLMConfigIn(BaseModel):
    kind: Literal["ollama", "openai_compat", "anthropic"] = "ollama"
    endpoint: str = Field(min_length=4, max_length=500)
    model: str = Field(min_length=1, max_length=200)
    # Empty string = leave existing key untouched. None = clear key.
    api_key: str | None = None
    temperature: float = Field(0.1, ge=0.0, le=2.0)
    max_tokens: int = Field(2048, ge=64, le=32000)
    timeout_seconds: int = Field(90, ge=5, le=600)
    json_mode: bool = True


@router.get("/llm", dependencies=[Depends(require_role(*READ_ROLES))])
async def get_llm(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cfg = await llm.load_config(db)
    return cfg.to_safe_dict()


@router.put("/llm", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def put_llm(
    dto: LLMConfigIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    current = await llm.load_config(db)

    # Special handling for api_key:
    #   - None  → clear it
    #   - ""    → keep existing
    #   - else  → overwrite
    if dto.api_key is None:
        new_key = ""
    elif dto.api_key == "":
        new_key = current.api_key
    else:
        new_key = dto.api_key

    new_cfg = llm.LLMConfig(
        kind=dto.kind,
        endpoint=dto.endpoint.strip(),
        model=dto.model.strip(),
        api_key=new_key,
        temperature=dto.temperature,
        max_tokens=dto.max_tokens,
        timeout_seconds=dto.timeout_seconds,
        json_mode=dto.json_mode,
        extra=current.extra,
    )
    await llm.save_config(db, new_cfg)
    await db.commit()
    return new_cfg.to_safe_dict()


@router.post("/llm/ping", dependencies=[Depends(require_role(*READ_ROLES))])
async def ping_llm(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cfg = await llm.load_config(db)
    result = await llm.ping(cfg)
    return {
        "kind": cfg.kind,
        "endpoint": cfg.endpoint,
        "model": cfg.model,
        **result,
    }


# ── Theme (Phase 9 Push 3) ─────────────────────────────────────────────────
#
# Two scopes — 'admin' and 'storefront' — stored as separate JSONB blobs at
# `app_settings.key='admin.theme'` and `'storefront.theme'`. The frontend
# applies the theme on bootstrap by setting CSS custom properties on
# `document.documentElement`. `preset` selects a curated palette; `overrides`
# are per-token user tweaks; `mode` ('light' | 'dark') overrides the preset's
# intrinsic mode for color-scheme.
#
# A public, no-auth GET /storefront/theme is exposed via the public router
# below so the storefront can fetch its theme without requiring a JWT.

_THEME_SCOPES: dict[str, str] = {
    "admin":      "admin.theme",
    "storefront": "storefront.theme",
}
_DEFAULT_PRESET = "default"

# Whitelist of CSS variables we let the user override. Anything else is
# dropped server-side so a malicious payload can't inject arbitrary properties.
# Keep this in sync with admin/src/lib/theme.ts TOKENS array.
_ALLOWED_VARS: set[str] = {
    # Palette
    "--color-bold-blue", "--color-electric-blue", "--color-neon-yellow",
    "--color-hot-pink",  "--color-jet-black",     "--color-soft-white",
    # Surface
    "--color-surface-0", "--color-surface-1", "--color-surface-2",
    "--color-surface-3", "--color-surface-4",
    # Text
    "--color-text-1", "--color-text-2", "--color-text-3",
    # Status
    "--color-success", "--color-warning", "--color-danger", "--color-info",
    # Typography
    "--font-sans", "--font-display", "--font-mono",
    # Radii
    "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-2xl", "--radius-full",
    # Glass
    "--glass-blur", "--glass-saturate", "--glass-opacity",
    # Motion
    "--duration-fast", "--duration-base", "--duration-slow",
    # Background
    "--bg-glow-1", "--bg-glow-2", "--bg-glow-3",
}

# Per-kind validators. Anything that doesn't match its kind is dropped.
_COLOR_RE = re.compile(
    r"^("
    r"#[0-9a-fA-F]{3,8}"
    r"|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)"
    r"|hsla?\(\s*-?\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+)\s*)?\)"
    r")$",
)
_LENGTH_RE   = re.compile(r"^(\d+(?:\.\d+)?)(px|rem|em|%)$")
_DURATION_RE = re.compile(r"^(\d+(?:\.\d+)?)(ms|s)$")
_UNITLESS_RE = re.compile(r"^\d+(?:\.\d+)?$")

# Sane numeric bounds per-token. Keeps an admin (or a curl call) from
# saving e.g. --glass-opacity: 0 (invisible cards) or --duration-fast: 99999s
# (frozen UI). The Theme Studio sliders already honour these in-UI; this
# defends against manual API calls and tampered JSON imports.
#
# Each value is (min, max) in the token's *base* unit:
#   length tokens     → px (so --radius-2xl gets [0, 56])
#   duration tokens   → ms
#   unitless tokens   → raw number
_NUMERIC_BOUNDS: dict[str, tuple[float, float]] = {
    "--radius-sm":      (0,     16),
    "--radius-md":      (0,     24),
    "--radius-lg":      (0,     32),
    "--radius-xl":      (0,     40),
    "--radius-2xl":     (0,     56),
    # --radius-full is intentionally unbounded (typically 9999px)
    "--glass-blur":     (0,     60),
    "--glass-saturate": (50,   250),    # %
    "--glass-opacity":  (0.05,   1.0),
    "--duration-fast":  (50,   1000),
    "--duration-base":  (50,   2000),
    "--duration-slow":  (50,   3000),
}


def _check_numeric_bounds(key: str, raw: str) -> bool:
    """Returns True iff the value is within the sane range for `key`,
    OR there are no bounds defined for that key (length/font/etc that
    don't have numeric semantics)."""
    bounds = _NUMERIC_BOUNDS.get(key)
    if bounds is None:
        return True
    lo, hi = bounds
    # Extract the numeric portion. The regexes above each have the number
    # in group 1, but we don't need to know which one matched — just parse
    # the leading number.
    m = re.match(r"^(\d+(?:\.\d+)?)", raw)
    if not m:
        return False
    n = float(m.group(1))
    return lo <= n <= hi
# Fonts: allow letters, digits, spaces, single/double quotes, commas, hyphens —
# deliberately strict so no `url()` / `expression()` / unicode escapes sneak in.
_FONT_RE     = re.compile(r"^[A-Za-z0-9 ,\"'\-]+$")

_COLOR_KEYS = {k for k in _ALLOWED_VARS if k.startswith(("--color-", "--bg-glow-"))}
_FONT_KEYS  = {"--font-sans", "--font-display", "--font-mono"}
_LENGTH_KEYS = {
    "--radius-sm", "--radius-md", "--radius-lg", "--radius-xl", "--radius-2xl",
    "--radius-full", "--glass-blur", "--glass-saturate",
}
_DURATION_KEYS = {"--duration-fast", "--duration-base", "--duration-slow"}
_UNITLESS_KEYS = {"--glass-opacity"}


def _validate_value(key: str, raw: str) -> str | None:
    v = raw.strip()
    if not v or len(v) > 200:
        return None
    if key in _COLOR_KEYS:
        return v if _COLOR_RE.match(v) else None
    if key in _FONT_KEYS:
        return v if _FONT_RE.match(v) else None
    if key in _LENGTH_KEYS:
        if not _LENGTH_RE.match(v): return None
        return v if _check_numeric_bounds(key, v) else None
    if key in _DURATION_KEYS:
        if not _DURATION_RE.match(v): return None
        return v if _check_numeric_bounds(key, v) else None
    if key in _UNITLESS_KEYS:
        if not _UNITLESS_RE.match(v): return None
        return v if _check_numeric_bounds(key, v) else None
    return None


def _sanitize_overrides(raw: dict[str, Any]) -> dict[str, str]:
    """Backward-compat helper used by readers — silently filters."""
    clean, _dropped = _sanitize_overrides_with_diagnostics(raw)
    return clean


def _sanitize_overrides_with_diagnostics(
    raw: dict[str, Any],
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Same as _sanitize_overrides but also returns a per-rejected-key
    diagnostic list. Used by writes so the UI can tell the user
    "your value for --font-sans was rejected because of invalid characters".

    Each diagnostic is `{ "key": str, "reason": str, "value": str }` where
    `value` is the offending input truncated to 60 chars (so a malicious
    payload can't be echoed wholesale into the response).
    """
    clean: dict[str, str] = {}
    dropped: list[dict[str, str]] = []
    if not isinstance(raw, dict):
        return clean, dropped
    for key, val in raw.items():
        if key not in _ALLOWED_VARS:
            dropped.append({"key": str(key)[:80], "reason": "unknown_token", "value": ""})
            continue
        if not isinstance(val, str):
            dropped.append({"key": key, "reason": "non_string", "value": ""})
            continue
        if len(val) > 200:
            dropped.append({"key": key, "reason": "too_long", "value": val[:60]})
            continue
        ok = _validate_value(key, val)
        if ok is None:
            # Pick a reason hint based on the key kind
            if key in _COLOR_KEYS:    reason = "invalid_color"
            elif key in _FONT_KEYS:   reason = "invalid_font"
            elif key in _LENGTH_KEYS: reason = "invalid_length"
            elif key in _DURATION_KEYS: reason = "invalid_duration"
            elif key in _UNITLESS_KEYS: reason = "invalid_number"
            else: reason = "invalid_value"
            dropped.append({"key": key, "reason": reason, "value": val[:60]})
            continue
        clean[key] = ok
    return clean, dropped


def _scope_key(scope: str) -> str:
    if scope not in _THEME_SCOPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown theme scope '{scope}'")
    return _THEME_SCOPES[scope]


def _normalise_mode(raw: Any) -> str | None:
    if raw in ("light", "dark"):
        return raw
    return None


class ThemeIn(BaseModel):
    preset:    str = Field(default=_DEFAULT_PRESET, max_length=64)
    overrides: dict[str, str] = Field(default_factory=dict)
    mode:      str | None = Field(default=None)


async def _load_theme(db: AsyncSession, key: str) -> dict[str, Any]:
    row = await db.execute(text(
        "SELECT value, updated_at FROM app_settings WHERE key = :k"
    ), {"k": key})
    r = row.first()
    if not r:
        return {"preset": _DEFAULT_PRESET, "overrides": {}, "mode": None, "updated_at": None}
    val = r[0] if isinstance(r[0], dict) else json.loads(r[0])
    return {
        "preset":     str(val.get("preset", _DEFAULT_PRESET))[:64],
        "overrides":  _sanitize_overrides(val.get("overrides", {})),
        "mode":       _normalise_mode(val.get("mode")),
        "updated_at": r[1].isoformat() if r[1] else None,
    }


@router.get("/theme", dependencies=[Depends(require_role(*READ_ROLES))])
async def get_theme(
    scope: str = "admin",
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await _load_theme(db, _scope_key(scope))


@router.put("/theme", dependencies=[Depends(require_role(*WRITE_ROLES))])
async def put_theme(
    dto:   ThemeIn,
    scope: str = "admin",
    db:    AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    key = _scope_key(scope)
    clean_overrides, dropped = _sanitize_overrides_with_diagnostics(dto.overrides)
    payload = {
        "preset":    dto.preset.strip()[:64] or _DEFAULT_PRESET,
        "overrides": clean_overrides,
        "mode":      _normalise_mode(dto.mode),
    }
    await db.execute(text("""
        INSERT INTO app_settings (key, value, updated_at)
             VALUES (:k, CAST(:v AS JSONB), NOW())
        ON CONFLICT (key) DO UPDATE
                  SET value = EXCLUDED.value,
                      updated_at = NOW()
    """), {"k": key, "v": json.dumps(payload)})
    await db.commit()
    # `dropped` is part of the response (not the persisted value) so the UI
    # can tell the user which keys were silently rejected this round.
    return {**payload, "updated_at": None, "dropped": dropped}


# ── Public (no-auth) storefront theme endpoint ─────────────────────────────
#
# Lives on a separate router with no `dependencies` list so the public
# storefront can fetch the theme without holding a JWT. Mounted alongside
# /api/v1 by api/main.py.

public_router = APIRouter(tags=["public-settings"])


@public_router.get("/storefront/theme")
async def get_public_storefront_theme(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Public read of the storefront theme.

    No auth, but this endpoint never echoes anything other than
    sanitized + whitelisted CSS values so it cannot leak admin-side data
    even if the column is somehow polluted.
    """
    return await _load_theme(db, _THEME_SCOPES["storefront"])
