import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.gzip import GZipMiddleware

from api.core.config import get_settings
from api.core.db import SessionLocal, engine
from api.core.logging import bind_request_id, setup_logging
from api.core.migrations import MigrationLockBusy, run_pending_migrations
from api.core.ratelimit import RateLimiter, client_key
from api.routes import auth, catalog, enrichment, events, health, images, intel, issues, jobs, orders, products, products_import, public_orders, scraper, settings as settings_route, stores

# Structured JSON logging — all lines on stdout, request_id flows via
# ContextVar so handlers don't have to thread it through every call.
setup_logging(component="api")
log = logging.getLogger("glstore")

_settings = get_settings()
_limiter = RateLimiter(_settings.rate_limit_per_minute)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with SessionLocal() as db:
        await db.execute(text("SELECT 1"))
    log.info("db connection ok", extra={"event": "startup"})

    # Auto-apply pending migrations before serving requests. The runner
    # holds an advisory lock so multiple replicas don't race; if another
    # replica is already migrating we wait briefly then proceed (the
    # other replica will have completed).
    #
    # Failure modes:
    #   · Tampered migration → MigrationChecksumMismatch raised; we let
    #     it propagate so the container crashes loud (production-correct
    #     — never run modified SQL silently).
    #   · Long lock wait     → MigrationLockBusy after 30s; we log + skip.
    #     The other replica will have applied them, so this replica
    #     comes up against an already-current schema.
    # Serverless deployments (Vercel) have no single startup and apply
    # migrations once at setup time instead — so this is gated off there.
    if _settings.run_startup_migrations:
        try:
            report = await run_pending_migrations(engine)
            if report.applied:
                log.info(
                    "startup migrations applied",
                    extra={"applied": report.applied, "duration_ms": report.duration_ms,
                           "event": "startup.migrations.applied"},
                )
        except MigrationLockBusy:
            log.warning(
                "another replica is running migrations; proceeding without applying",
                extra={"event": "startup.migrations.skipped"},
            )
    else:
        log.info("startup migrations disabled (run_startup_migrations=false)",
                 extra={"event": "startup.migrations.disabled"})

    yield
    log.info("api shutting down", extra={"event": "shutdown"})
    await engine.dispose()


app = FastAPI(
    title=_settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _settings.environment != "production" else None,
    redoc_url=None,
)

# Middlewares
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
if _settings.environment == "production":
    # Configurable so a store can go live on any domain (incl. a *.vercel.app
    # platform subdomain). ALLOWED_HOSTS="*" accepts any host — appropriate for
    # a single store on a platform subdomain; tighten it once on a real domain.
    _hosts = [h.strip() for h in _settings.allowed_hosts.split(",") if h.strip()]
    if "*" in _hosts:
        _hosts = ["*"]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_hosts or ["*"])


@app.middleware("http")
async def request_id_and_rate_limit(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = rid
    # Bind into the ContextVar so EVERY log call within the request's
    # async context (handlers, services, workers spawned via run_in_executor)
    # picks up the request_id automatically — no manual extra= needed.
    bind_request_id(rid)

    # Rate limit mutating + public endpoints (skip GETs to keep dashboards snappy)
    if request.method != "GET":
        try:
            _limiter.check(client_key(request))
        except Exception:
            log.warning(
                "rate limit exceeded",
                extra={"client": client_key(request), "method": request.method, "path": request.url.path},
            )
            return JSONResponse(
                {"error": "rate_limit_exceeded", "request_id": rid},
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"x-request-id": rid},
            )

    try:
        response = await call_next(request)
    except Exception:
        log.exception(
            "unhandled error",
            extra={"method": request.method, "path": request.url.path},
        )
        return JSONResponse(
            {"error": "internal_error", "request_id": rid},
            status_code=500,
            headers={"x-request-id": rid},
        )

    # Which store served this request. Set by whichever store dependency the
    # route used (require_store / resolve_store / require_admin_store_for), so
    # it is only present on store-scoped routes — absent on /healthz, /docs.
    # Makes "why did I get the wrong catalog?" answerable from the response.
    #
    # Read from request.state, NOT from bound_store(): `call_next` runs the
    # endpoint in a copied context, so a ContextVar set inside a dependency
    # never propagates back up here. `scope["state"]` does. See bind_store().
    served_by = getattr(request.state, "store", None)
    if served_by is not None:
        response.headers["x-store"] = served_by.slug

    response.headers["x-request-id"] = rid
    response.headers["x-content-type-options"] = "nosniff"
    response.headers["x-frame-options"] = "DENY"
    response.headers["referrer-policy"] = "strict-origin-when-cross-origin"
    response.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        {"error": "validation_failed", "detail": exc.errors(),
         "request_id": getattr(request.state, "request_id", None)},
        status_code=422,
    )


# Health endpoints (Phase 9 Push 6) live on the root, not /api/v1, so a
# load balancer / orchestrator can poll them without auth or version-prefix
# concerns. /healthz is liveness, /readyz is readiness, /healthz/details
# is admin-only deep diagnostic.
app.include_router(health.router)


# Route mounting
# IMPORTANT: catalog router (which has static paths like /products/graph and
# /products/featured) MUST register BEFORE products.router (which has the
# dynamic /products/{product_id} catcher). FastAPI matches in registration
# order — without this, /products/graph would 422 because "graph" can't be
# coerced to a UUID.
app.include_router(auth.router, prefix="/api/v1")
app.include_router(catalog.router, prefix="/api/v1")
# IMPORTANT: images router uses static paths /products/{id}/images and
# /images/pending — register before products.router so the static segments
# don't get caught by /products/{product_id}.
app.include_router(images.router, prefix="/api/v1")
app.include_router(products.router, prefix="/api/v1")
app.include_router(products_import.router, prefix="/api/v1")
app.include_router(enrichment.router, prefix="/api/v1")
app.include_router(issues.router, prefix="/api/v1")
app.include_router(settings_route.router, prefix="/api/v1")
# Public, no-auth storefront theme: GET /api/v1/storefront/theme
app.include_router(settings_route.public_router, prefix="/api/v1")
app.include_router(scraper.router, prefix="/api/v1")
app.include_router(public_orders.router, prefix="/api/v1")
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(intel.router, prefix="/api/v1")
app.include_router(orders.router, prefix="/api/v1")
app.include_router(stores.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
