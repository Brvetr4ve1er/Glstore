from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Service
    app_name: str = "GLstore API"
    environment: str = Field("development", pattern="^(development|staging|production)$")
    debug: bool = False

    # Database
    database_url: str  # e.g. postgresql+asyncpg://user:pass@db:5432/glstore
    db_pool_size: int = 10
    db_max_overflow: int = 10
    db_pool_timeout: int = 30

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
