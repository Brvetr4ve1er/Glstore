"""Applicant document storage (api/services/documents).

The first file-upload path on the platform, carrying identity documents, so
the rules are tested directly: the type comes from the bytes, the key never
contains the shopper's filename, and no store is used where it must not be.
"""
from __future__ import annotations

from uuid import UUID

import pytest

pytest.importorskip("pydantic_settings")

from api.core.config import get_settings  # noqa: E402
from api.services import documents as docs  # noqa: E402
from api.services.documents.local import LocalDocumentStore  # noqa: E402

SID = UUID("11111111-1111-4111-8111-111111111111")
AID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
DID = UUID("dddddddd-dddd-4ddd-8ddd-dddddddddddd")

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj"
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00"
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 "


# ── The type comes from the bytes ─────────────────────────────────────────

@pytest.mark.parametrize("data,expected", [
    (PDF, "application/pdf"), (JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp"),
])
def test_accepted_formats_are_recognised_by_their_magic_bytes(data, expected):
    assert docs.sniff_content_type(data) == expected


@pytest.mark.parametrize("data", [
    b"<!DOCTYPE html><script>alert(1)</script>",
    b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>",
    b"MZ\x90\x00\x03",                 # Windows executable
    b"PK\x03\x04",                     # zip / docx
    b"GIF89a",
    b"RIFF\x24\x00\x00\x00WAVEfmt ",   # RIFF but not WebP
    b"",
])
def test_anything_else_is_refused_whatever_it_claims_to_be(data):
    assert docs.sniff_content_type(data) is None


# ── Keys and names ────────────────────────────────────────────────────────

def test_the_object_key_is_built_from_ids_only():
    assert docs.object_key(SID, AID, DID, "application/pdf") == f"{SID}/applications/{AID}/{DID}.pdf"


def test_the_object_key_takes_no_filename_at_all():
    import inspect

    assert "filename" not in inspect.signature(docs.object_key).parameters


@pytest.mark.parametrize("raw,expected", [
    ("carte_identite.pdf", "carte_identite.pdf"),
    ("../../etc/passwd", "passwd"),
    ("C:\\Users\\amina\\Bulletin de paie.pdf", "Bulletin de paie.pdf"),
    ('fiche"<script>.pdf', "fiche_script_.pdf"),
    ("line\nbreak.png", "line_break.png"),
    ("", "document"),
    (None, "document"),
    ("...", "document"),
])
def test_filenames_are_display_text_only(raw, expected):
    assert docs.safe_filename(raw) == expected


def test_a_long_filename_is_capped():
    assert len(docs.safe_filename("a" * 500 + ".pdf")) == 200


# ── Which store may be used ───────────────────────────────────────────────

@pytest.fixture
def settings(monkeypatch):
    s = get_settings()
    for k, v in {
        "documents_storage": "local", "environment": "development", "db_serverless": False,
        "r2_endpoint": "", "r2_access_key": "", "r2_secret_key": "",
        "r2_bucket": "media-public", "r2_documents_bucket": "",
    }.items():
        monkeypatch.setattr(s, k, v)
    return s


def test_the_local_store_works_in_local_development(settings):
    assert isinstance(docs.get_document_store(), LocalDocumentStore)


@pytest.mark.parametrize("env", ["staging", "production"])
def test_the_local_store_is_refused_outside_development(settings, monkeypatch, env):
    monkeypatch.setattr(settings, "environment", env)
    with pytest.raises(docs.DocumentsUnavailable):
        docs.get_document_store()


def test_the_local_store_is_refused_on_serverless(settings, monkeypatch):
    """A serverless function's disk is scratch space — documents would vanish,
    or worse, outlive the instance somewhere nobody looks."""
    monkeypatch.setattr(settings, "db_serverless", True)
    with pytest.raises(docs.DocumentsUnavailable):
        docs.get_document_store()


def test_r2_without_full_configuration_is_refused(settings, monkeypatch):
    monkeypatch.setattr(settings, "documents_storage", "r2")
    monkeypatch.setattr(settings, "r2_endpoint", "https://acct.r2.cloudflarestorage.com")
    with pytest.raises(docs.DocumentsUnavailable):
        docs.get_document_store()


def test_documents_may_never_go_to_the_public_media_bucket(settings, monkeypatch):
    monkeypatch.setattr(settings, "documents_storage", "r2")
    monkeypatch.setattr(settings, "r2_endpoint", "https://acct.r2.cloudflarestorage.com")
    monkeypatch.setattr(settings, "r2_access_key", "k")
    monkeypatch.setattr(settings, "r2_secret_key", "s")
    monkeypatch.setattr(settings, "r2_documents_bucket", "media-public")
    with pytest.raises(docs.DocumentsUnavailable, match="private bucket"):
        docs.get_document_store()


def test_a_fully_configured_private_r2_bucket_is_used(settings, monkeypatch):
    pytest.importorskip("boto3")
    monkeypatch.setattr(settings, "documents_storage", "r2")
    monkeypatch.setattr(settings, "r2_endpoint", "https://acct.r2.cloudflarestorage.com")
    monkeypatch.setattr(settings, "r2_access_key", "k")
    monkeypatch.setattr(settings, "r2_secret_key", "s")
    monkeypatch.setattr(settings, "r2_documents_bucket", "applicant-documents")
    store = docs.get_document_store()
    assert type(store).__name__ == "R2DocumentStore" and store.bucket == "applicant-documents"


def test_an_unknown_backend_is_refused_not_ignored(settings, monkeypatch):
    monkeypatch.setattr(settings, "documents_storage", "dropbox")
    with pytest.raises(docs.DocumentsUnavailable):
        docs.get_document_store()


# ── The local store itself ────────────────────────────────────────────────

async def test_the_local_store_round_trips_and_deletes(tmp_path):
    store = LocalDocumentStore(tmp_path)
    key = docs.object_key(SID, AID, DID, "application/pdf")
    await store.put(key, PDF, "application/pdf")
    assert await store.get(key) == PDF
    await store.delete(key)
    await store.delete(key)          # deleting twice is not an error
    assert not (tmp_path / key).exists()


async def test_the_local_store_cannot_be_walked_out_of(tmp_path):
    store = LocalDocumentStore(tmp_path / "root")
    with pytest.raises(ValueError):
        await store.put("../escaped.pdf", PDF, "application/pdf")
