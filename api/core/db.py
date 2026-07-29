from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from api.core.config import get_settings

_settings = get_settings()

# `echo=True` writes raw SQL to stdout via print() — bypasses our JSON
# formatter and double-logs. We rely on the logger path exclusively; trace
# SQL with GL_LOG_LEVEL=DEBUG instead.
if _settings.db_serverless:
    # Serverless (Vercel/Lambda): each function instance is ephemeral and may
    # freeze mid-life, so a persistent pool would strand Neon connections.
    # NullPool opens/closes a connection per checkout; statement_cache_size=0
    # keeps asyncpg safe behind Neon's pgbouncer-style pooler (prepared
    # statements don't survive transaction-level pooling).
    engine = create_async_engine(
        _settings.database_url,
        poolclass=NullPool,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
        echo=False,
    )
else:
    engine = create_async_engine(
        _settings.database_url,
        pool_size=_settings.db_pool_size,
        max_overflow=_settings.db_max_overflow,
        pool_timeout=_settings.db_pool_timeout,
        pool_pre_ping=True,
        echo=False,
    )

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def db_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
