"""Applicant document storage — the platform's first file-upload path.

What goes through here is the most sensitive data AMANTCOM holds: identity
cards, payslips, bank statements. So:

- PRIVATE storage only. The existing R2 bucket backs a public CDN
  (`r2_public_base`); documents get their own bucket, and the factory refuses
  to run if the two are the same.
- Uploads pass THROUGH the API: the server sees every byte, caps the size,
  sniffs the real type from magic bytes (never the browser's Content-Type),
  and hashes it. Presigned PUT would skip all of that.
- Object keys are built from ids. The shopper's filename is display metadata,
  never a path component, never logged.
- FAIL CLOSED, like api/services/sms: no usable store means 503, never a
  silent fallback. The local disk store is development-only.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import PurePosixPath, PureWindowsPath
from typing import Protocol
from uuid import UUID

from api.core.config import get_settings

# Content types accepted, by the magic bytes that identify them.
EXTENSIONS = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


class DocumentsUnavailable(RuntimeError):
    """No document store may be used in this environment."""


class DocumentStore(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...


def sniff_content_type(data: bytes) -> str | None:
    """The type the bytes actually are, or None if it is not one we accept."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def object_key(store_id: UUID, application_id: UUID, document_id: UUID, content_type: str) -> str:
    return f"{store_id}/applications/{application_id}/{document_id}.{EXTENSIONS[content_type]}"


_UNSAFE = re.compile(r"[\x00-\x1f\x7f\"\\/<>:|?*]+")


def safe_filename(name: str | None) -> str:
    """A display name: no directories, no control or quoting characters,
    at most 200 characters. It is never used to build a path."""
    raw = name or ""
    base = PureWindowsPath(PurePosixPath(raw).name).name
    base = unicodedata.normalize("NFC", base)
    base = _UNSAFE.sub("_", base).strip(" .")
    return base[:200] or "document"


def get_document_store() -> DocumentStore:
    s = get_settings()
    backend = s.documents_storage.strip().lower()

    if backend == "local":
        if s.environment != "development" or s.db_serverless:
            raise DocumentsUnavailable(
                "the local document store is development-only; configure "
                "DOCUMENTS_STORAGE=r2 with a private R2_DOCUMENTS_BUCKET"
            )
        from api.services.documents.local import LocalDocumentStore

        return LocalDocumentStore(s.local_documents_dir)

    if backend == "r2":
        if not (s.r2_endpoint and s.r2_access_key and s.r2_secret_key and s.r2_documents_bucket):
            raise DocumentsUnavailable("R2 document storage is not fully configured")
        if s.r2_documents_bucket == s.r2_bucket:
            raise DocumentsUnavailable(
                "R2_DOCUMENTS_BUCKET must be a private bucket, not the public media bucket"
            )
        from api.services.documents.r2 import R2DocumentStore

        return R2DocumentStore(s.r2_endpoint, s.r2_access_key, s.r2_secret_key, s.r2_documents_bucket)

    raise DocumentsUnavailable(f"unknown document storage {backend!r}")
