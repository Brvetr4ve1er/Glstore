"""Development document store: files under a gitignored local directory.

`get_document_store()` refuses to build this outside local development, so
applicant documents never land on a serverless function's scratch disk.
"""
from __future__ import annotations

from pathlib import Path

from starlette.concurrency import run_in_threadpool


class LocalDocumentStore:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        # Keys are built from ids, but check anyway: nothing may resolve
        # outside the root.
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("document key escapes the storage root")
        return path

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)

        def write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        await run_in_threadpool(write)

    async def get(self, key: str) -> bytes:
        return await run_in_threadpool(self._path(key).read_bytes)

    async def delete(self, key: str) -> None:
        await run_in_threadpool(self._path(key).unlink, True)
