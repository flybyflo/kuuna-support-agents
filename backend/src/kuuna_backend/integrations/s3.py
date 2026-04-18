from __future__ import annotations

from functools import lru_cache

from typing import Any, cast

import boto3  # type: ignore[import-untyped]
from botocore.client import Config  # type: ignore[import-untyped]
from botocore.exceptions import ClientError  # type: ignore[import-untyped]

from kuuna_backend.config.settings import get_settings


@lru_cache
def get_s3_client() -> Any:
    settings = get_settings()

    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def ensure_bucket_exists(bucket_name: str) -> None:
    client = get_s3_client()

    try:
        client.head_bucket(Bucket=bucket_name)
        return
    except ClientError:
        pass

    client.create_bucket(Bucket=bucket_name)


def upload_bytes(
    *,
    bucket_name: str,
    object_key: str,
    data: bytes,
    content_type: str | None,
) -> None:
    ensure_bucket_exists(bucket_name)
    client = get_s3_client()

    extra_args: dict[str, str] = {}
    if content_type:
        extra_args["ContentType"] = content_type

    client.put_object(Bucket=bucket_name, Key=object_key, Body=data, **extra_args)


def create_presigned_get_url(*, bucket_name: str, object_key: str, expires_in_seconds: int = 86400) -> str:
    client = get_s3_client()
    url = client.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": bucket_name, "Key": object_key},
        ExpiresIn=expires_in_seconds,
    )
    return cast(str, url)
