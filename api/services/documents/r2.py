"""Cloudflare R2 document store (S3 API). The bucket must be PRIVATE: R2
buckets are private unless a public domain is attached, and this one must
never have one. Reads go through the API; no presigned URL is ever issued,
so there is no bearer link to leak through logs or browser history."""
from __future__ import annotations

import boto3
from botocore.config import Config
from starlette.concurrency import run_in_threadpool


class R2DocumentStore:
    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str):
        self.bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await run_in_threadpool(
            self._client.put_object,
            Bucket=self.bucket, Key=key, Body=data, ContentType=content_type,
        )

    async def get(self, key: str) -> bytes:
        def read() -> bytes:
            return self._client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

        return await run_in_threadpool(read)

    async def delete(self, key: str) -> None:
        await run_in_threadpool(self._client.delete_object, Bucket=self.bucket, Key=key)
