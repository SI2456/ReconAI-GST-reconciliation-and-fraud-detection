import re
from pathlib import Path
from urllib.parse import quote

from app.core.config import PROJECT_ROOT, settings


def _local_storage() -> bool:
    return not (settings.r2_endpoint_url and settings.r2_access_key_id and settings.r2_secret_access_key)


def _uploads_root() -> Path:
    return Path(settings.upload_dir).resolve()


def r2_client():
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
    )


def upload_bytes(object_key: str, content: bytes, content_type: str) -> str:
    if _local_storage():
        root = _uploads_root()
        local_path = (root / object_key).resolve()
        if not local_path.is_relative_to(root):
            raise ValueError(f"Refusing to write outside the uploads directory: {object_key!r}")
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(content)
        return str(local_path)

    client = r2_client()
    client.put_object(Bucket=settings.r2_bucket, Key=object_key, Body=content, ContentType=content_type)
    return object_key


def read_bytes(object_key: str) -> bytes:
    """Read back a previously stored object (local disk or R2)."""
    if _local_storage():
        local_path = _uploads_root() / object_key
        if not local_path.exists():
            # Older uploads may store a full path as the key, possibly relative to the project.
            legacy = Path(object_key)
            local_path = legacy if legacy.is_absolute() else PROJECT_ROOT / legacy
        return local_path.read_bytes()

    client = r2_client()
    response = client.get_object(Bucket=settings.r2_bucket, Key=object_key)
    return response["Body"].read()


def delete_object(object_key: str) -> None:
    """Remove a stored object (local disk or R2); a missing object is not an error."""
    if _local_storage():
        root = _uploads_root()
        local_path = (root / object_key).resolve()
        if local_path.is_relative_to(root):
            local_path.unlink(missing_ok=True)
        return
    r2_client().delete_object(Bucket=settings.r2_bucket, Key=object_key)


def get_bytes(object_key: str) -> tuple[bytes, str]:
    import mimetypes
    data = read_bytes(object_key)
    ctype, _ = mimetypes.guess_type(object_key)
    return data, ctype or "application/octet-stream"


def inline_disposition(filename: str) -> str:
    """Content-Disposition value that is safe for quotes and non-ASCII names."""
    fallback = re.sub(r"[^A-Za-z0-9_.-]", "_", filename or "") or "file"
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename or fallback)}"
