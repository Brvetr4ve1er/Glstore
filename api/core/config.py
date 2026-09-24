from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Service
    app_name: str = "AMANTCOM API"
    environment: str = Field("development", pattern="^(development|staging|production)$")
    debug: bool = False

    # Database
    database_url: str  # e.g. postgresql+asyncpg://user:pass@db:5432/glstore
    db_pool_size: int = 10
    db_max_overflow: int = 10
    db_pool_timeout: int = 30
    # Serverless mode (Vercel/Lambda): each function instance is ephemeral, so a
    # persistent connection pool is wrong — use NullPool + disable asyncpg's
    # statement cache so we stay safe behind a pgbouncer-style pooler (Neon).
    db_serverless: bool = False

    # Deployment behaviour
    # On a persistent host the app applies pending SQL migrations at startup.
    # On serverless there is no single startup — migrations are applied once at
    # setup time (scripts/deploy/init_remote_db.py) — so this is turned off.
    run_startup_migrations: bool = True
    # Single-store deployments serve ONE store on ANY hostname. This lets a
    # first store go live on a platform subdomain (e.g. *.vercel.app, which
    # changes per deploy) without registering every host in store_domains.
    # Turn OFF the moment you run more than one brand.
    single_store_mode: bool = False
    # Shared secret for Vercel Cron. Empty means the maintenance endpoint
    # refuses every request -- see api/routes/internal.py for why that is
    # the safe default.
    cron_secret: str = ""
    # Hosts TrustedHostMiddleware accepts in production. Comma-separated.
    # Use "*" to accept any host (fine for a single store on a platform subdomain).
    allowed_hosts: str = "*.glstore.dz,glstore.dz"

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_minutes: int = 60
    jwt_refresh_ttl_days: int = 14
    bcrypt_rounds: int = 12

    # CORS
    cors_origins: str = "http://localhost:5173"

    # R2 (Cloudflare) — URLs only; uploads go direct from admin via presigned URLs
    r2_endpoint: str = ""
    r2_access_key: str = ""
    r2_secret_key: str = ""
    r2_bucket: str = ""
    r2_public_base: str = ""  # e.g. https://cdn.glstore.dz

    # Workers
    event_worker_batch_size: int = 50
    event_worker_poll_interval_s: float = 1.0
    reservation_ttl_minutes: int = 30

    # Rate limiting
    rate_limit_per_minute: int = 60

    # Customer identity (phone OTP) — see api/routes/customer_auth.py.
    # "console" prints codes to the local terminal and is refused anywhere but
    # development; no real provider is wired yet (procurement, not code).
    sms_provider: str = "console"
    otp_ttl_seconds: int = 300
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 60
    otp_max_per_phone_per_hour: int = 5
    otp_max_per_ip_per_hour: int = 10
    # Cost backstop: an attacker rotating numbers AND addresses still stops here.
    otp_max_per_store_per_hour: int = 300
    customer_session_ttl_days: int = 30

    # Financing (plan, Decision 2). While False, every public figure is an
    # ESTIMATE and no status reads as approved. The OPERATOR flips this, after
    # the legal conversation has happened — never code, never a default.
    financing_terms_public: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
