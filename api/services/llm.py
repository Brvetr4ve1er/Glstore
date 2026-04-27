"""
LLM client — pluggable across:
  - Ollama        (local, default)            kind="ollama"
  - OpenAI-compat (LM Studio, OpenAI, vLLM)   kind="openai_compat"
  - Anthropic                                  kind="anthropic"

Each backend exposes the same interface:
    await chat(cfg, system, user, json_mode=True) -> dict | str
    await ping(cfg) -> {"online": bool, "models": list[str], "error": str | None}

Plain httpx — no provider SDKs. JSON mode is enforced via prompt + post-parse
fence-stripping fallback so flaky models still produce parseable output.

Config is stored in `app_settings.key='llm.config'` as JSONB and loaded once
per request (no caching layer yet — it's cheap).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger("glstore.llm")

LLMKind = Literal["ollama", "openai_compat", "anthropic"]


# ── Config ──────────────────────────────────────────────────────────────────

@dataclass
class LLMConfig:
    kind: LLMKind = "ollama"
    endpoint: str = "http://host.docker.internal:11434"
    model: str = "llama3.1:8b"
    api_key: str = ""                # only needed for hosted backends
    temperature: float = 0.1
    max_tokens: int = 2048
    timeout_seconds: int = 90
    json_mode: bool = True
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "LLMConfig":
        # Drop unknown keys so old/new schema versions don't crash construction.
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        clean = {k: v for k, v in (d or {}).items() if k in known}
        return cls(**clean)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_safe_dict(self) -> dict[str, Any]:
        """Mask api_key for client display."""
        d = self.to_dict()
        if d.get("api_key"):
            d["api_key"] = "•" * 8
            d["api_key_set"] = True
        else:
            d["api_key_set"] = False
        return d


_CONFIG_KEY = "llm.config"


async def load_config(db: AsyncSession) -> LLMConfig:
    row = await db.execute(
        text("SELECT value FROM app_settings WHERE key = :k"),
        {"k": _CONFIG_KEY},
    )
    r = row.first()
    if not r:
        # Seed default if migration didn't run (defensive)
        cfg = LLMConfig()
        await save_config(db, cfg)
        await db.commit()
        return cfg
    raw = r[0] if isinstance(r[0], dict) else json.loads(r[0])
    return LLMConfig.from_dict(raw)


async def save_config(db: AsyncSession, cfg: LLMConfig) -> None:
    await db.execute(text("""
        INSERT INTO app_settings (key, value, updated_at)
             VALUES (:k, CAST(:v AS JSONB), NOW())
        ON CONFLICT (key) DO UPDATE
                  SET value      = EXCLUDED.value,
                      updated_at = NOW()
    """), {"k": _CONFIG_KEY, "v": json.dumps(cfg.to_dict())})


# ── JSON repair ─────────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def extract_json(content: str) -> dict[str, Any] | None:
    """Pull a JSON object out of arbitrary LLM output. Tolerates markdown fences,
    leading prose, and trailing text. Returns None if unparseable."""
    if not content:
        return None
    text_in = content.strip()

    # 1) Try whole content as-is
    try:
        v = json.loads(text_in)
        if isinstance(v, dict):
            return v
    except json.JSONDecodeError:
        pass

    # 2) Pull out fenced block
    m = _FENCE_RE.search(text_in)
    if m:
        try:
            v = json.loads(m.group(1))
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            pass

    # 3) Slice from first `{` to last `}`
    start, end = text_in.find("{"), text_in.rfind("}")
    if start != -1 and end > start:
        try:
            v = json.loads(text_in[start:end + 1])
            if isinstance(v, dict):
                return v
        except json.JSONDecodeError:
            pass

    return None


# ── Backends ────────────────────────────────────────────────────────────────

class LLMError(RuntimeError):
    """Raised on transport / decode failures. Routes turn this into 502/422."""


async def _ollama_chat(cfg: LLMConfig, system: str, user: str) -> str:
    """Ollama /api/chat — returns the assistant message content."""
    url = cfg.endpoint.rstrip("/") + "/api/chat"
    body = {
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "stream": False,
        "options": {
            "temperature": cfg.temperature,
            "num_predict": cfg.max_tokens,
        },
    }
    if cfg.json_mode:
        body["format"] = "json"

    async with httpx.AsyncClient(timeout=cfg.timeout_seconds) as client:
        try:
            r = await client.post(url, json=body)
        except httpx.RequestError as e:
            raise LLMError(f"Ollama connection failed: {e}") from e
    if r.status_code != 200:
        raise LLMError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    msg = (data.get("message") or {}).get("content") or ""
    if not msg:
        raise LLMError("Ollama returned empty content")
    return msg


async def _ollama_models(cfg: LLMConfig) -> list[str]:
    url = cfg.endpoint.rstrip("/") + "/api/tags"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
    if r.status_code != 200:
        return []
    data = r.json()
    return [m.get("name", "") for m in data.get("models", []) if m.get("name")]


async def _openai_chat(cfg: LLMConfig, system: str, user: str) -> str:
    """OpenAI-compatible /v1/chat/completions — works with LM Studio, vLLM,
    OpenAI, and most hosted endpoints exposing the same shape."""
    base = cfg.endpoint.rstrip("/")
    # Tolerate endpoints that already include /v1 or even /chat/completions
    if base.endswith("/chat/completions"):
        url = base
    elif base.endswith("/v1"):
        url = base + "/chat/completions"
    else:
        url = base + "/v1/chat/completions"

    headers = {"Content-Type": "application/json"}
    if cfg.api_key:
        headers["Authorization"] = f"Bearer {cfg.api_key}"

    body: dict[str, Any] = {
        "model": cfg.model,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        "stream": False,
    }
    if cfg.json_mode:
        body["response_format"] = {"type": "json_object"}

    async with httpx.AsyncClient(timeout=cfg.timeout_seconds) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
        except httpx.RequestError as e:
            raise LLMError(f"OpenAI-compat connection failed: {e}") from e
    if r.status_code != 200:
        raise LLMError(f"OpenAI-compat HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise LLMError("OpenAI-compat returned no choices")
    return (choices[0].get("message") or {}).get("content") or ""


async def _openai_models(cfg: LLMConfig) -> list[str]:
    base = cfg.endpoint.rstrip("/")
    url = base + "/models" if base.endswith("/v1") else base + "/v1/models"
    headers = {"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url, headers=headers)
        except httpx.RequestError:
            return []
    if r.status_code != 200:
        return []
    data = r.json()
    items = data.get("data") or data.get("models") or []
    return [m.get("id") or m.get("name") or "" for m in items if isinstance(m, dict)]


async def _anthropic_chat(cfg: LLMConfig, system: str, user: str) -> str:
    """Native Anthropic /v1/messages."""
    base = cfg.endpoint.rstrip("/") or "https://api.anthropic.com"
    url = base + "/v1/messages"
    headers = {
        "Content-Type": "application/json",
        "x-api-key": cfg.api_key,
        "anthropic-version": cfg.extra.get("anthropic_version", "2023-06-01"),
    }
    body = {
        "model": cfg.model,
        "max_tokens": cfg.max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "temperature": cfg.temperature,
    }
    async with httpx.AsyncClient(timeout=cfg.timeout_seconds) as client:
        try:
            r = await client.post(url, headers=headers, json=body)
        except httpx.RequestError as e:
            raise LLMError(f"Anthropic connection failed: {e}") from e
    if r.status_code != 200:
        raise LLMError(f"Anthropic HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    blocks = data.get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


async def _anthropic_models(_cfg: LLMConfig) -> list[str]:
    # Anthropic doesn't expose a /models list endpoint we can hit cheaply;
    # return the canonical recent set so the UI can offer a dropdown.
    return [
        "claude-opus-4-1",
        "claude-sonnet-4-5",
        "claude-sonnet-4-1",
        "claude-haiku-4-1",
    ]


# ── Public API ──────────────────────────────────────────────────────────────

async def chat(cfg: LLMConfig, system: str, user: str, json_mode: bool = True) -> tuple[str, dict[str, Any] | None]:
    """Run a single chat call. Returns (raw_content, parsed_json_or_none).

    Caller decides whether to require JSON. When json_mode=True, this function
    asks the backend for JSON output AND attempts post-parse fallback so soft
    failures still yield structured data."""
    cfg = LLMConfig.from_dict({**cfg.to_dict(), "json_mode": json_mode})

    if cfg.kind == "ollama":
        raw = await _ollama_chat(cfg, system, user)
    elif cfg.kind == "openai_compat":
        raw = await _openai_chat(cfg, system, user)
    elif cfg.kind == "anthropic":
        raw = await _anthropic_chat(cfg, system, user)
    else:
        raise LLMError(f"Unknown LLM kind: {cfg.kind}")

    parsed = extract_json(raw) if json_mode else None
    return raw, parsed


async def ping(cfg: LLMConfig) -> dict[str, Any]:
    """Health-check + model discovery. Never raises."""
    try:
        if cfg.kind == "ollama":
            models = await _ollama_models(cfg)
            online = bool(models) or await _probe_root(cfg.endpoint, "/api/version")
        elif cfg.kind == "openai_compat":
            models = await _openai_models(cfg)
            online = bool(models)
        elif cfg.kind == "anthropic":
            models = await _anthropic_models(cfg)
            online = bool(cfg.api_key)  # we can't really ping without spending tokens
        else:
            return {"online": False, "models": [], "error": f"Unknown kind: {cfg.kind}"}
        return {"online": bool(online), "models": models, "error": None}
    except Exception as e:
        log.warning("ping failed: %s", e)
        return {"online": False, "models": [], "error": str(e)}


async def _probe_root(endpoint: str, path: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(endpoint.rstrip("/") + path)
        return r.status_code < 500
    except httpx.RequestError:
        return False
