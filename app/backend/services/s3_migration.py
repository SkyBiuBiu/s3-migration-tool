"""S3-compatible object storage helpers and migration engine (boto3)."""
import base64
import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.client import Config
from botocore.exceptions import ClientError

from core.mask_crypto import decrypt_text, encrypt_text, key_prefix

LIST_PAGE_SIZE = 1000
STEP_TIME_BUDGET = 20.0
MAX_FAILED_KEPT = 1000
MAX_LOGS = 300
PRESIGN_TTL = 3600
TEXT_PREVIEW_BYTES = 200 * 1024
MULTIPART_THRESHOLD = 8 * 1024 * 1024
TRANSFER_CONFIG = TransferConfig(multipart_threshold=MULTIPART_THRESHOLD, max_concurrency=4)
NOT_FOUND = ("404", "NoSuchKey", "NotFound")


# ---------- credentials ----------
def enc(value: Optional[str]) -> str:
    value = (value or "").strip()
    return encrypt_text(value) if value and not value.startswith(key_prefix) else value


def dec(value: Optional[str]) -> str:
    if value and value.startswith(key_prefix):
        try:
            return decrypt_text(value)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("密钥解密失败，请重新填写该连接的 AccessKey / SecretKey") from exc
    return (value or "").strip()


def mask(value: Optional[str]) -> str:
    try:
        plain = dec(value)
    except ValueError:
        return "****"
    return f"{plain[:4]}****{plain[-4:]}" if len(plain) > 8 else "****"


# ---------- client ----------
def make_client(conn: Dict[str, Any]):
    endpoint = (conn.get("endpoint") or "").strip() or None
    if endpoint:
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"https://{endpoint}"
        scheme, rest = endpoint.split("://", 1)
        host = rest.split("/", 1)[0]
        bucket = (conn.get("bucket") or "").strip()
        if bucket and host.startswith(f"{bucket}."):
            host = host[len(bucket) + 1:]
        endpoint = f"{scheme}://{host}"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=(conn.get("region") or "").strip() or "us-east-1",
        aws_access_key_id=(conn.get("access_key") or "").strip(),
        aws_secret_access_key=(conn.get("secret_key") or "").strip(),
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if conn.get("path_style") else "virtual"},
            connect_timeout=10,
            read_timeout=600,
            retries={"max_attempts": 3},
            max_pool_connections=64,
            # boto3>=1.36 adds CRC32 trailers by default; COS/OSS/MinIO-old reject them.
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def error_text(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        err = exc.response.get("Error", {})
        return f"{err.get('Code', 'Error')}: {err.get('Message', str(exc))}"
    return str(exc)


def _etag(value: Optional[str]) -> str:
    return (value or "").strip('"')


def _item(o: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "key": o["Key"],
        "size": o["Size"],
        "etag": _etag(o.get("ETag")),
        "mtime": o["LastModified"].timestamp(),
        "storage_class": o.get("StorageClass") or "STANDARD",
    }


def _head(client, bucket: str, key: str) -> Optional[Dict[str, Any]]:
    try:
        return client.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in NOT_FOUND:
            return None
        raise


def loads_list(raw: Optional[str]) -> List[Any]:
    try:
        data = json.loads(raw) if raw else []
        return data if isinstance(data, list) else []
    except (ValueError, TypeError):
        return []


# ---------- connection / browsing ----------
def test_connection(conn: Dict[str, Any]) -> Dict[str, Any]:
    resp = make_client(conn).list_objects_v2(Bucket=conn["bucket"], MaxKeys=1)
    return {"ok": True, "key_count": resp.get("KeyCount", 0)}


def browse(conn: Dict[str, Any], prefix: str, token: Optional[str]) -> Dict[str, Any]:
    kwargs = {"Bucket": conn["bucket"], "Prefix": prefix or "", "Delimiter": "/", "MaxKeys": 200}
    if token:
        kwargs["ContinuationToken"] = token
    resp = make_client(conn).list_objects_v2(**kwargs)
    return {
        "folders": [p["Prefix"] for p in resp.get("CommonPrefixes", [])],
        "objects": [_item(o) for o in resp.get("Contents", []) if o["Key"] != prefix],
        "next_token": resp.get("NextContinuationToken"),
    }


def search(conn: Dict[str, Any], prefix: str, query: str, limit: int = 200, budget: float = 20.0) -> Dict[str, Any]:
    client, q = make_client(conn), query.strip().lower()
    started, results, scanned, token = time.monotonic(), [], 0, None
    while True:
        kwargs = {"Bucket": conn["bucket"], "Prefix": prefix or "", "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        for o in resp.get("Contents", []):
            scanned += 1
            if q in o["Key"][len(prefix or ""):].lower():
                results.append(_item(o))
                if len(results) >= limit:
                    return {"objects": results, "scanned": scanned, "truncated": True}
        token = resp.get("NextContinuationToken")
        if not token:
            return {"objects": results, "scanned": scanned, "truncated": False}
        if time.monotonic() - started > budget:
            return {"objects": results, "scanned": scanned, "truncated": True}


def presign(conn: Dict[str, Any], key: str, op: str, content_type: Optional[str] = None) -> str:
    client = make_client(conn)
    if op == "put":
        params = {"Bucket": conn["bucket"], "Key": key}
        if content_type:
            params["ContentType"] = content_type
        return client.generate_presigned_url("put_object", Params=params, ExpiresIn=PRESIGN_TTL)
    params = {"Bucket": conn["bucket"], "Key": key}
    if op == "download":
        filename = key.rsplit("/", 1)[-1] or "download"
        params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
    return client.generate_presigned_url("get_object", Params=params, ExpiresIn=PRESIGN_TTL)


def preview_text(conn: Dict[str, Any], key: str) -> Dict[str, Any]:
    obj = make_client(conn).get_object(Bucket=conn["bucket"], Key=key, Range=f"bytes=0-{TEXT_PREVIEW_BYTES - 1}")
    raw = obj["Body"].read()
    total = int((obj.get("ContentRange") or "/0").rsplit("/", 1)[-1] or 0) or len(raw)
    return {"text": raw.decode("utf-8", errors="replace"), "truncated": total > len(raw), "content_type": obj.get("ContentType")}


def make_folder(conn: Dict[str, Any], key: str) -> None:
    key = key if key.endswith("/") else f"{key}/"
    make_client(conn).put_object(Bucket=conn["bucket"], Key=key, Body=b"")


def _add_content_md5(request, **_kwargs) -> None:
    """COS/OSS require Content-MD5 on DeleteObjects; newer boto3 sends CRC32 instead."""
    body = request.body or b""
    if isinstance(body, str):
        body = body.encode("utf-8")
    request.headers["Content-MD5"] = base64.b64encode(hashlib.md5(body).digest()).decode()


def delete_objects(conn: Dict[str, Any], keys: List[str], prefixes: List[str], budget: float = 20.0) -> Dict[str, Any]:
    client, bucket = make_client(conn), conn["bucket"]
    client.meta.events.register("before-sign.s3.DeleteObjects", _add_content_md5)
    started, deleted, errors, truncated = time.monotonic(), 0, [], False

    def _flush(batch: List[str]) -> None:
        nonlocal deleted
        for i in range(0, len(batch), 1000):
            part = batch[i:i + 1000]
            resp = client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in part], "Quiet": True})
            errs = resp.get("Errors", [])
            errors.extend(f"{e.get('Key')}: {e.get('Message')}" for e in errs)
            deleted += len(part) - len(errs)

    _flush([k for k in keys if k])
    for prefix in prefixes:
        token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            resp = client.list_objects_v2(**kwargs)
            _flush([o["Key"] for o in resp.get("Contents", [])])
            token = resp.get("NextContinuationToken")
            if not token:
                break
            if time.monotonic() - started > budget:
                truncated = True
                break
    return {"deleted": deleted, "errors": errors[:20], "truncated": truncated}


def stats(conn: Dict[str, Any], prefix: str = "", budget: float = 25.0) -> Dict[str, Any]:
    client = make_client(conn)
    started, token = time.monotonic(), None
    count, total, by_ext, by_class, largest = 0, 0, {}, {}, []
    truncated = False
    while True:
        kwargs = {"Bucket": conn["bucket"], "Prefix": prefix or "", "MaxKeys": 1000}
        if token:
            kwargs["ContinuationToken"] = token
        resp = client.list_objects_v2(**kwargs)
        for o in resp.get("Contents", []):
            if o["Key"].endswith("/"):
                continue
            count += 1
            total += o["Size"]
            name = o["Key"].rsplit("/", 1)[-1]
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else "(无后缀)"
            e = by_ext.setdefault(ext, {"count": 0, "size": 0})
            e["count"] += 1
            e["size"] += o["Size"]
            sc = o.get("StorageClass") or "STANDARD"
            c = by_class.setdefault(sc, {"count": 0, "size": 0})
            c["count"] += 1
            c["size"] += o["Size"]
            largest.append({"key": o["Key"], "size": o["Size"]})
            if len(largest) > 50:
                largest = sorted(largest, key=lambda x: -x["size"])[:10]
        token = resp.get("NextContinuationToken")
        if not token:
            break
        if time.monotonic() - started > budget:
            truncated = True
            break
    ext_list = sorted(({"name": k, **v} for k, v in by_ext.items()), key=lambda x: -x["size"])
    return {
        "count": count,
        "total_size": total,
        "by_ext": ext_list[:12],
        "by_class": sorted(({"name": k, **v} for k, v in by_class.items()), key=lambda x: -x["size"]),
        "largest": sorted(largest, key=lambda x: -x["size"])[:10],
        "truncated": truncated,
    }


# ---------- migration ----------
def build_filter(opts: Dict[str, Any]) -> Callable[[Dict[str, Any]], bool]:
    def _suffixes(raw: Optional[str]) -> List[str]:
        return [s.strip().lower().lstrip("*") for s in (raw or "").replace("，", ",").split(",") if s.strip()]

    def _ts(raw: Optional[str]) -> Optional[float]:
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw).timestamp()
        except ValueError:
            return None

    inc, exc = _suffixes(opts.get("include_suffixes")), _suffixes(opts.get("exclude_suffixes"))
    min_size, max_size = opts.get("min_size"), opts.get("max_size")
    after, before = _ts(opts.get("modified_after")), _ts(opts.get("modified_before"))

    def _ok(item: Dict[str, Any]) -> bool:
        key = item["key"].lower()
        if inc and not any(key.endswith(s) for s in inc):
            return False
        if exc and any(key.endswith(s) for s in exc):
            return False
        if min_size is not None and item["size"] < min_size:
            return False
        if max_size is not None and item["size"] > max_size:
            return False
        if after is not None and item["mtime"] < after:
            return False
        if before is not None and item["mtime"] > before:
            return False
        return True

    return _ok


def list_page(conn: Dict[str, Any], prefix: str, token: Optional[str], opts: Dict[str, Any]) -> Dict[str, Any]:
    kwargs = {"Bucket": conn["bucket"], "Prefix": prefix or "", "MaxKeys": LIST_PAGE_SIZE}
    if token:
        kwargs["ContinuationToken"] = token
    resp = make_client(conn).list_objects_v2(**kwargs)
    keep = build_filter(opts)
    raw = [_item(o) for o in resp.get("Contents", []) if not o["Key"].endswith("/")]
    items = [i for i in raw if keep(i)]
    return {"items": items, "scanned": len(raw), "next_token": resp.get("NextContinuationToken")}


def target_key_for(key: str, source_prefix: str, target_prefix: str) -> str:
    rel = key[len(source_prefix):] if source_prefix and key.startswith(source_prefix) else key
    return f"{target_prefix or ''}{rel}"


class RateLimiter:
    """Token-bucket style limiter shared by all copy threads of a step."""

    def __init__(self, bytes_per_sec: float):
        self.rate = bytes_per_sec
        self.lock = threading.Lock()
        self.next_t = time.monotonic()

    def consume(self, n: int) -> None:
        if not self.rate or n <= 0:
            return
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next_t)
            self.next_t = start + n / self.rate
            wait = start - now
        if wait > 0:
            time.sleep(wait)


class ThrottledReader:
    def __init__(self, body, limiter: RateLimiter):
        self.body, self.limiter = body, limiter

    def read(self, size: int = -1) -> bytes:
        data = self.body.read(size if size and size > 0 else None)
        self.limiter.consume(len(data))
        return data


def should_skip(mode: str, item: Dict[str, Any], head: Optional[Dict[str, Any]]) -> bool:
    if not head or mode == "full" or head.get("ContentLength") != item["size"]:
        return False
    if mode == "skip_existing":
        return True
    se, de = item.get("etag", ""), _etag(head.get("ETag"))
    if se and de and "-" not in se and "-" not in de:
        return se == de
    return head["LastModified"].timestamp() >= item.get("mtime", 0)


def copy_one(sc, dc, src, dst, item, opts, limiter) -> Dict[str, Any]:
    dest_key = target_key_for(item["key"], opts.get("source_prefix") or "", opts.get("target_prefix") or "")
    mode = opts.get("sync_mode") or "skip_existing"
    if mode != "full" and should_skip(mode, item, _head(dc, dst["bucket"], dest_key)):
        return {"status": "skipped", "bytes": 0, "verified": False}
    if opts.get("_server_side"):
        # Same account/endpoint: storage copies internally, no data flows through this server.
        dc.copy({"Bucket": src["bucket"], "Key": item["key"]}, dst["bucket"], dest_key, Config=TRANSFER_CONFIG)
    else:
        obj = sc.get_object(Bucket=src["bucket"], Key=item["key"])
        extra = {k: obj[k] for k in ("ContentType", "CacheControl", "ContentEncoding", "ContentDisposition") if obj.get(k)}
        if obj.get("Metadata"):
            extra["Metadata"] = obj["Metadata"]
        body = ThrottledReader(obj["Body"], limiter) if limiter.rate else obj["Body"]
        dc.upload_fileobj(body, dst["bucket"], dest_key, ExtraArgs=extra or None, Config=TRANSFER_CONFIG)
    verified = False
    if opts.get("verify"):
        head = _head(dc, dst["bucket"], dest_key)
        if not head:
            raise ValueError("校验失败：目标对象不存在")
        if head.get("ContentLength") != item["size"]:
            raise ValueError(f"校验失败：大小不一致（源 {item['size']} / 目标 {head.get('ContentLength')}）")
        se, de = item.get("etag", ""), _etag(head.get("ETag"))
        if item["size"] < MULTIPART_THRESHOLD and se and de and "-" not in se and "-" not in de and se != de:
            raise ValueError("校验失败：ETag(MD5) 不一致")
        verified = True
    return {"status": "done", "bytes": item["size"], "verified": verified}


def copy_batch(src, dst, items: List[Dict[str, Any]], opts: Dict[str, Any], budget: float = STEP_TIME_BUDGET) -> Dict[str, Any]:
    sc, dc = make_client(src), make_client(dst)
    same = all((src.get(k) or "") == (dst.get(k) or "") for k in ("access_key", "secret_key", "region")) and \
        sc.meta.endpoint_url == dc.meta.endpoint_url
    opts = {**opts, "_server_side": same}
    limiter = RateLimiter(float(opts.get("bandwidth_mbps") or 0) * 1024 * 1024)
    conc = max(1, min(int(opts.get("concurrency") or 4), 32))
    res = {"done": 0, "skipped": 0, "verified": 0, "bytes": 0, "processed_bytes": 0, "failed": [], "remaining": []}
    started, idx = time.monotonic(), 0
    with ThreadPoolExecutor(max_workers=conc) as pool:
        while idx < len(items) and time.monotonic() - started <= budget:
            chunk = items[idx:idx + conc * 2]
            idx += len(chunk)
            futures = [(it, pool.submit(copy_one, sc, dc, src, dst, it, opts, limiter)) for it in chunk]
            for it, fut in futures:
                try:
                    r = fut.result()
                    res[r["status"]] += 1
                    res["bytes"] += r["bytes"]
                    res["verified"] += int(r["verified"])
                except Exception as exc:  # noqa: BLE001
                    res["failed"].append({**it, "error": error_text(exc)[:300]})
                res["processed_bytes"] += it["size"]
    res["remaining"] = items[idx:]
    return res


def now_log(level: str, msg: str) -> Dict[str, Any]:
    return {"t": time.time(), "level": level, "msg": msg}


def env_mask_key_set() -> bool:
    return bool(os.environ.get("MASK_KEY"))
