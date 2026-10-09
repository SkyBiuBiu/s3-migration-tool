"""Regression tests for the migration engine (multipart, retry, resume, filters)."""
import os
import sys

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")

from services import s3_migration as s3  # noqa: E402

SRC = {"bucket": "src", "access_key": "ak", "secret_key": "sk", "region": "us-east-1", "endpoint": "", "path_style": True}
DST = {**SRC, "bucket": "dst"}
DST_OTHER = {**DST, "access_key": "ak2"}  # different creds -> forces streaming (non server-side) copy


@pytest.fixture()
def buckets():
    with mock_aws():
        s3._CLIENTS.clear()
        c = boto3.client("s3", region_name="us-east-1")
        c.create_bucket(Bucket="src")
        c.create_bucket(Bucket="dst")
        yield c
        s3._CLIENTS.clear()


def _put(c, key, data: bytes, bucket="src"):
    c.put_object(Bucket=bucket, Key=key, Body=data, ContentType="text/plain")


def _items(prefix=""):
    return s3.list_page(SRC, prefix, None, {})["items"]


def test_target_key_mapping():
    assert s3.target_key_for("a/b/c.txt", "a/", "x/") == "x/b/c.txt"
    assert s3.target_key_for("a/b.txt", "", "") == "a/b.txt"
    assert s3.target_key_for("z.txt", "a/", "x/") == "x/z.txt"


def test_filter_suffix_and_size():
    keep = s3.build_filter({"include_suffixes": ".jpg,.png", "min_size": 10})
    assert keep({"key": "a.JPG", "size": 20, "mtime": 0})
    assert not keep({"key": "a.txt", "size": 20, "mtime": 0})
    assert not keep({"key": "a.png", "size": 5, "mtime": 0})


@pytest.mark.parametrize("dst", [DST, DST_OTHER], ids=["server_side", "streaming"])
def test_copy_small_objects_and_metadata(buckets, dst):
    _put(buckets, "p/a.txt", b"hello")
    _put(buckets, "p/sub/b.txt", b"world")
    res = s3.copy_batch(SRC, dst, _items("p/"), {"source_prefix": "p/", "target_prefix": "q/", "verify": True})
    assert res["done"] == 2 and not res["failed"] and not res["remaining"]
    assert res["verified"] == 2
    obj = buckets.get_object(Bucket="dst", Key="q/sub/b.txt")
    assert obj["Body"].read() == b"world"
    assert obj["ContentType"] == "text/plain"


def test_multipart_large_object_streaming(buckets):
    data = os.urandom(s3.MULTIPART_THRESHOLD + 3 * 1024 * 1024)
    _put(buckets, "big.bin", data)
    res = s3.copy_batch(SRC, DST_OTHER, _items(), {"verify": True})
    assert res["done"] == 1 and res["bytes"] == len(data)
    head = buckets.head_object(Bucket="dst", Key="big.bin")
    assert head["ContentLength"] == len(data)
    assert "-" in head["ETag"], "large object should be uploaded via multipart"
    assert buckets.get_object(Bucket="dst", Key="big.bin")["Body"].read() == data


def test_resume_skips_already_copied(buckets):
    for i in range(5):
        _put(buckets, f"f{i}.txt", f"v{i}".encode())
    items = _items()
    first = s3.copy_batch(SRC, DST, items[:2], {})
    assert first["done"] == 2
    second = s3.copy_batch(SRC, DST, items, {"sync_mode": "skip_existing"})
    assert second["skipped"] == 2 and second["done"] == 3


def test_changed_mode_recopies_modified_object(buckets):
    _put(buckets, "a.txt", b"one")
    s3.copy_batch(SRC, DST_OTHER, _items(), {})
    _put(buckets, "a.txt", b"two")  # same size, different content
    res = s3.copy_batch(SRC, DST_OTHER, _items(), {"sync_mode": "changed"})
    assert res["done"] == 1
    assert buckets.get_object(Bucket="dst", Key="a.txt")["Body"].read() == b"two"


def test_full_mode_overwrites(buckets):
    _put(buckets, "a.txt", b"one")
    s3.copy_batch(SRC, DST, _items(), {})
    res = s3.copy_batch(SRC, DST, _items(), {"sync_mode": "full"})
    assert res["done"] == 1 and res["skipped"] == 0


def test_failed_items_are_reported_then_retry_succeeds(buckets):
    _put(buckets, "ok.txt", b"ok")
    items = _items() + [{"key": "missing.txt", "size": 3, "etag": "", "mtime": 0}]
    res = s3.copy_batch(SRC, DST_OTHER, items, {})
    assert res["done"] == 1
    assert [f["key"] for f in res["failed"]] == ["missing.txt"]
    assert res["failed"][0]["error"]
    # Retry: the source object now exists, so re-running only the failed items succeeds.
    _put(buckets, "missing.txt", b"abc")
    retry = s3.copy_batch(SRC, DST_OTHER, [{k: v for k, v in f.items() if k != "error"} for f in res["failed"]], {})
    assert retry["done"] == 1 and not retry["failed"]


def test_time_budget_leaves_remaining_for_next_step(buckets):
    for i in range(6):
        _put(buckets, f"r{i}.txt", b"x")
    res = s3.copy_batch(SRC, DST, _items(), {"concurrency": 1}, budget=-1)
    assert res["done"] == 0 and len(res["remaining"]) == 6
    res2 = s3.copy_batch(SRC, DST, res["remaining"], {"concurrency": 1})
    assert res2["done"] == 6 and not res2["remaining"]


def test_list_page_skips_folder_markers(buckets):
    _put(buckets, "dir/", b"")
    _put(buckets, "dir/a.txt", b"a")
    page = s3.list_page(SRC, "dir/", None, {})
    assert [i["key"] for i in page["items"]] == ["dir/a.txt"]


def test_client_cache_reuses_instance(buckets):
    assert s3.make_client(SRC) is s3.make_client(SRC)
    assert s3.make_client(SRC) is not s3.make_client(DST_OTHER)


def test_password_hashing_roundtrip():
    from routers.s3_account import hash_password, verify_password

    h = hash_password("secret123")
    assert verify_password("secret123", h)
    assert not verify_password("wrong", h)
