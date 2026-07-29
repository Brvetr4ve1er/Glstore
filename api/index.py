"""
Vercel serverless entry point for the FastAPI app.

Vercel's Python runtime serves the module-level ASGI callable named `app`.
We simply re-export the existing FastAPI application — no logic lives here.

Why this file exists (and why it's tiny):
  · vercel.json declares an explicit build for THIS file with @vercel/python,
    which turns off Vercel's zero-config "every api/*.py is its own function"
    behaviour. So the rest of the `api/` package is bundled as this function's
    dependency instead of being mistaken for many separate functions.
  · The heavy scraper/worker code is never imported at API load time (verified),
    so the serverless bundle stays lean — no Playwright/Chromium.

Runtime expectations on Vercel (set as Environment Variables in the dashboard):
    ENVIRONMENT=production
    DB_SERVERLESS=true
    RUN_STARTUP_MIGRATIONS=false      # schema applied once via init script
    SINGLE_STORE_MODE=true            # one store, served on any host
    ALLOWED_HOSTS=*                   # accept the *.vercel.app host
    DATABASE_URL=postgresql+asyncpg://...neon...
    JWT_SECRET=<64+ random chars>
    CORS_ORIGINS=https://<your-project>.vercel.app
"""
import os
import sys

# Ensure the repo root is importable so `import api.main` resolves when the
# function's working directory is the entrypoint's folder.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from api.main import app  # noqa: E402  (path setup must run first)

# Vercel's @vercel/python runtime detects and serves this ASGI `app`.
__all__ = ["app"]
