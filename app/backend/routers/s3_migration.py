import asyncio
import base64
import binascii
import json
import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.app_user import get_app_user as get_current_user
from models.migration_tasks import Migration_tasks
from models.storage_connections import Storage_connections
from schemas.auth import UserResponse
from services import s3_migration as s3

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/s3", tags=["s3"])

ACTIVE = ("pending", "running")
LOCK_TTL = 1800.0  # a single large object may take minutes on slow links
_bg_running: set = set()


# ---------- schemas ----------
class ConnIn(BaseModel):
    id: Optional[int] = None
    name: str
    endpoint: Optional[str] = ""
    region: Optional[str] = ""
    access_key: Optional[str] = ""
    secret_key: Optional[str] = ""
    bucket: str
    path_style: Optional[bool] = False


class TestRequest(BaseModel):
    connection_id: Optional[int] = None
    endpoint: Optional[str] = None
    region: Optional[str] = None
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    bucket: Optional[str] = None
    path_style: Optional[bool] = None


class BrowseRequest(BaseModel):
    connection_id: int
    prefix: str = ""
    token: Optional[str] = None


class SearchRequest(BaseModel):
    connection_id: int
    prefix: str = ""
    query: str


class KeyRequest(BaseModel):
    connection_id: int
    key: str
    op: str = "get"
    content_type: Optional[str] = None


class DeleteRequest(BaseModel):
    connection_id: int
    keys: List[str] = []
    prefixes: List[str] = []


class StatsRequest(BaseModel):
    connection_id: int
    prefix: str = ""


class SelectedItem(BaseModel):
    key: str
    size: int = 0
    etag: Optional[str] = ""
    mtime: Optional[float] = 0


class TaskIn(BaseModel):
    name: Optional[str] = None
    source_id: int
    target_id: int
    source_prefix: Optional[str] = ""
    target_prefix: Optional[str] = ""
    sync_mode: str = "skip_existing"
    verify: bool = True
    concurrency: int = 4
    bandwidth_mbps: Optional[float] = None
    include_suffixes: Optional[str] = ""
    exclude_suffixes: Optional[str] = ""
    min_size: Optional[float] = None
    max_size: Optional[float] = None
    modified_after: Optional[str] = None
    modified_before: Optional[str] = None
    selected_prefixes: List[str] = []
    selected_items: List[SelectedItem] = []


# ---------- helpers ----------
def conn_public(c: Storage_connections) -> Dict[str, Any]:
    return {
        "id": c.id, "name": c.name, "endpoint": c.endpoint or "", "region": c.region or "",
        "bucket": c.bucket, "path_style": bool(c.path_style),
        "access_key_masked": s3.mask(c.access_key), "secret_key_masked": s3.mask(c.secret_key),
    }


def conn_plain(c: Storage_connections) -> Dict[str, Any]:
    try:
        ak, sk = s3.dec(c.access_key), s3.dec(c.secret_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"连接「{c.name}」：{exc}")
    return {"endpoint": c.endpoint, "region": c.region, "access_key": ak, "secret_key": sk,
            "bucket": c.bucket, "path_style": bool(c.path_style)}


async def get_conn_row(db: AsyncSession, conn_id: int, user_id: str) -> Storage_connections:
    c = await db.scalar(select(Storage_connections).where(
        Storage_connections.id == conn_id, Storage_connections.user_id == user_id))
    if not c:
        raise HTTPException(status_code=404, detail=f"存储连接 {conn_id} 不存在")
    return c


async def load_conn(db: AsyncSession, conn_id: int, user_id: str) -> Dict[str, Any]:
    return conn_plain(await get_conn_row(db, conn_id, user_id))


async def load_task(db: AsyncSession, task_id: int, user_id: str) -> Migration_tasks:
    t = await db.scalar(select(Migration_tasks).where(
        Migration_tasks.id == task_id, Migration_tasks.user_id == user_id))
    if not t:
        raise HTTPException(status_code=404, detail="任务不存在")
    return t


def task_out(t: Migration_tasks, busy: bool = False) -> Dict[str, Any]:
    return {
        "id": t.id, "status": t.status, "busy": busy,
        "total_count": t.total_count or 0, "total_bytes": t.total_bytes or 0,
        "done_count": t.done_count or 0, "skipped_count": t.skipped_count or 0,
        "failed_count": t.failed_count or 0, "verified_count": t.verified_count or 0,
        "bytes_transferred": t.bytes_transferred or 0, "processed_bytes": t.processed_bytes or 0,
        "listing_done": bool(t.listing_done), "pending": len(s3.loads_list(t.pending_keys)),
        "error_message": t.error_message, "failed_items": s3.loads_list(t.failed_items),
        "logs": s3.loads_list(t.logs), "last_run_at": t.last_run_at or 0,
    }


def add_logs(t: Migration_tasks, entries: List[Dict[str, Any]]) -> None:
    if entries:
        t.logs = json.dumps((s3.loads_list(t.logs) + entries)[-s3.MAX_LOGS:], ensure_ascii=False)


async def to_thread_http(fn, *args):
    try:
        return await asyncio.to_thread(fn, *args)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=s3.error_text(exc))


# ---------- connections ----------
@router.get("/connections")
async def list_connections(db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    rows = (await db.scalars(select(Storage_connections).where(
        Storage_connections.user_id == user.id).order_by(Storage_connections.id.desc()))).all()
    changed = False
    for c in rows:  # migrate legacy plaintext credentials to encrypted storage
        for f in ("access_key", "secret_key"):
            v = getattr(c, f)
            if v and not v.startswith(s3.key_prefix):
                setattr(c, f, s3.enc(v))
                changed = True
    out = [conn_public(c) for c in rows]
    if changed:
        await db.commit()
    return {"items": out}


@router.post("/connections")
async def save_connection(data: ConnIn, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    if data.id:
        c = await get_conn_row(db, data.id, user.id)
    else:
        if not (data.access_key or "").strip() or not (data.secret_key or "").strip():
            raise HTTPException(status_code=400, detail="请填写 AccessKey 和 SecretKey")
        c = Storage_connections(user_id=user.id)
        db.add(c)
    c.name, c.bucket = data.name.strip(), data.bucket.strip()
    c.endpoint, c.region, c.path_style = (data.endpoint or "").strip(), (data.region or "").strip(), bool(data.path_style)
    if (data.access_key or "").strip():
        c.access_key = s3.enc(data.access_key)
    if (data.secret_key or "").strip():
        c.secret_key = s3.enc(data.secret_key)
    await db.commit()
    return conn_public(c)


@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: int, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    c = await get_conn_row(db, conn_id, user.id)
    await db.delete(c)
    await db.commit()
    return {"ok": True}


@router.post("/test")
async def test_connection(data: TestRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    conn = await load_conn(db, data.connection_id, user.id) if data.connection_id else {}
    for k, v in data.model_dump(exclude={"connection_id"}).items():
        if isinstance(v, str):
            v = v.strip()
        if v not in (None, "") or k not in conn:
            conn[k] = v
    missing = [n for k, n in (("access_key", "AccessKey"), ("secret_key", "SecretKey"), ("bucket", "Bucket")) if not conn.get(k)]
    if missing:
        raise HTTPException(status_code=400, detail=f"请填写：{'、'.join(missing)}")
    await db.commit()
    try:
        return await asyncio.to_thread(s3.test_connection, conn)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": s3.error_text(exc)}


# ---------- objects ----------
@router.post("/browse")
async def browse(data: BrowseRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    return await to_thread_http(s3.browse, conn, data.prefix, data.token)


@router.post("/search")
async def search(data: SearchRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    if not data.query.strip():
        raise HTTPException(status_code=400, detail="请输入搜索关键词")
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    return await to_thread_http(s3.search, conn, data.prefix, data.query)


@router.post("/presign")
async def presign(data: KeyRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    if data.op not in ("get", "download", "put"):
        raise HTTPException(status_code=400, detail="不支持的操作")
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    return {"url": await to_thread_http(s3.presign, conn, data.key, data.op, data.content_type)}


PROXY_UPLOAD_MAX = 5 * 1024 * 1024


class UploadRequest(BaseModel):
    connection_id: int
    key: str
    content_type: Optional[str] = None
    data_base64: str


@router.post("/upload")
async def upload_object(
    data: UploadRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)
):
    """Proxy upload through the backend (JSON + base64) so the bucket needs no CORS configuration."""
    if not data.key.strip("/ "):
        raise HTTPException(status_code=400, detail="对象 Key 不能为空")
    try:
        body = base64.b64decode(data.data_base64, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=400, detail="文件内容编码无效")
    if len(body) > PROXY_UPLOAD_MAX:
        raise HTTPException(status_code=413, detail="文件超过 5MB，请为 Bucket 配置 CORS 后使用直传")
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    key, ctype = data.key, data.content_type or "application/octet-stream"

    def _put() -> None:
        s3.make_client(conn).put_object(Bucket=conn["bucket"], Key=key, Body=body, ContentType=ctype)

    await to_thread_http(_put)
    return {"ok": True, "size": len(body)}


@router.post("/preview_text")
async def preview_text(data: KeyRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    return await to_thread_http(s3.preview_text, conn, data.key)


@router.post("/mkdir")
async def mkdir(data: KeyRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    if not data.key.strip("/ "):
        raise HTTPException(status_code=400, detail="请输入文件夹名称")
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    await to_thread_http(s3.make_folder, conn, data.key)
    return {"ok": True}


@router.post("/delete")
async def delete_objects(data: DeleteRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    if not data.keys and not data.prefixes:
        raise HTTPException(status_code=400, detail="未选择要删除的对象")
    if any(not p for p in data.prefixes):
        raise HTTPException(status_code=400, detail="不允许删除整个 Bucket")
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    return await to_thread_http(s3.delete_objects, conn, data.keys, data.prefixes)


@router.post("/stats")
async def stats(data: StatsRequest, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    conn = await load_conn(db, data.connection_id, user.id)
    await db.commit()
    return await to_thread_http(s3.stats, conn, data.prefix)


# ---------- migration tasks ----------
async def run_step(db: AsyncSession, task_id: int, user_id: str) -> Dict[str, Any]:
    """Advance one batch under a DB lock so background and browser runners never overlap."""
    now = time.time()
    res = await db.execute(
        update(Migration_tasks)
        .where(Migration_tasks.id == task_id, Migration_tasks.user_id == user_id,
               Migration_tasks.status.in_(ACTIVE),
               or_(Migration_tasks.locked_until.is_(None), Migration_tasks.locked_until < now))
        .values(locked_until=now + LOCK_TTL, status="running")
    )
    await db.commit()
    t = await load_task(db, task_id, user_id)
    if res.rowcount == 0:
        out = task_out(t, busy=t.status in ACTIVE)
        await db.commit()
        return out

    opts = {k: getattr(t, k) for k in (
        "source_prefix", "target_prefix", "sync_mode", "verify", "concurrency", "bandwidth_mbps",
        "include_suffixes", "exclude_suffixes", "min_size", "max_size", "modified_after", "modified_before")}
    pending = s3.loads_list(t.pending_keys)
    queue = s3.loads_list(t.prefix_queue)
    token, listing_done = t.continuation_token, bool(t.listing_done)
    try:
        src = await load_conn(db, t.source_id, user_id)
        dst = await load_conn(db, t.target_id, user_id)
    except HTTPException as exc:
        t.status, t.error_message, t.locked_until = "failed", exc.detail, 0
        await db.commit()
        return task_out(t)
    await db.commit()

    logs: List[Dict[str, Any]] = []
    new_count, new_bytes = 0, 0
    try:
        if not pending and not listing_done and queue:
            page = await asyncio.to_thread(s3.list_page, src, queue[0], token, opts)
            pending, token = page["items"], page["next_token"]
            new_count, new_bytes = len(pending), sum(i["size"] for i in pending)
            logs.append(s3.now_log("info", f"列举 {queue[0] or '/'}：扫描 {page['scanned']} 个，符合条件 {new_count} 个"))
            if token is None:
                queue = queue[1:]
        if not queue and token is None:
            listing_done = True
        result = await asyncio.to_thread(s3.copy_batch, src, dst, pending, opts)
    except Exception as exc:  # noqa: BLE001
        t = await load_task(db, task_id, user_id)
        msg = s3.error_text(exc)[:500]
        t.status, t.error_message, t.locked_until = "failed", msg, 0
        add_logs(t, [s3.now_log("error", msg)])
        await db.commit()
        return task_out(t)

    t = await load_task(db, task_id, user_id)
    failed_new = result["failed"]
    t.failed_items = json.dumps((s3.loads_list(t.failed_items) + failed_new)[-s3.MAX_FAILED_KEPT:], ensure_ascii=False)
    t.total_count = (t.total_count or 0) + new_count
    t.total_bytes = (t.total_bytes or 0) + new_bytes
    t.done_count = (t.done_count or 0) + result["done"]
    t.skipped_count = (t.skipped_count or 0) + result["skipped"]
    t.verified_count = (t.verified_count or 0) + result["verified"]
    t.failed_count = (t.failed_count or 0) + len(failed_new)
    t.bytes_transferred = int((t.bytes_transferred or 0) + result["bytes"])
    t.processed_bytes = (t.processed_bytes or 0) + result["processed_bytes"]
    t.pending_keys = json.dumps(result["remaining"], ensure_ascii=False)
    t.prefix_queue = json.dumps(queue, ensure_ascii=False)
    t.continuation_token = token
    t.listing_done = listing_done
    t.last_run_at = time.time()
    t.locked_until = 0
    processed = result["done"] + result["skipped"] + len(failed_new)
    if processed:
        logs.append(s3.now_log("info", f"本批：成功 {result['done']}，跳过 {result['skipped']}，失败 {len(failed_new)}，传输 {result['bytes']} 字节"))
    for f in failed_new[:5]:
        logs.append(s3.now_log("error", f"{f['key']}：{f['error']}"))
    if t.status == "running" and listing_done and not result["remaining"]:
        t.status = "completed"
        logs.append(s3.now_log("success", f"任务完成：成功 {t.done_count}，跳过 {t.skipped_count}，失败 {t.failed_count}"))
    add_logs(t, logs)
    out = task_out(t)
    await db.commit()
    return out


async def background_run(task_id: int, user_id: str) -> None:
    """Keep stepping server-side so the migration continues after the browser is closed."""
    if task_id in _bg_running:
        return
    _bg_running.add(task_id)
    try:
        idle = 0
        while idle < 40:
            async for db in get_db():
                out = await run_step(db, task_id, user_id)
                break
            if out["status"] not in ACTIVE:
                return
            idle = idle + 1 if out.get("busy") else 0
            await asyncio.sleep(3 if out.get("busy") else 0.2)
    except Exception:  # noqa: BLE001
        logger.exception("background migration %s stopped", task_id)
    finally:
        _bg_running.discard(task_id)


def spawn(task_id: int, user_id: str) -> None:
    try:
        asyncio.get_running_loop().create_task(background_run(task_id, user_id))
    except RuntimeError:
        logger.warning("no running loop for background task %s", task_id)


@router.post("/tasks")
async def create_task(data: TaskIn, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    await get_conn_row(db, data.source_id, user.id)
    await get_conn_row(db, data.target_id, user.id)
    sp, tp = data.source_prefix or "", data.target_prefix or ""
    if data.source_id == data.target_id and sp == tp:
        raise HTTPException(status_code=400, detail="源与目标不能完全相同")
    if data.sync_mode not in ("full", "skip_existing", "incremental"):
        raise HTTPException(status_code=400, detail="无效的同步模式")
    selected = [{"key": i.key, "size": i.size, "etag": i.etag or "", "mtime": i.mtime or 0} for i in data.selected_items]
    queue = data.selected_prefixes if (data.selected_prefixes or selected) else [sp]
    t = Migration_tasks(
        user_id=user.id, name=(data.name or "").strip() or f"迁移 {time.strftime('%m-%d %H:%M')}",
        source_id=data.source_id, target_id=data.target_id, source_prefix=sp, target_prefix=tp,
        sync_mode=data.sync_mode, skip_existing=data.sync_mode != "full", verify=data.verify,
        concurrency=max(1, min(data.concurrency, 32)), bandwidth_mbps=data.bandwidth_mbps or None,
        include_suffixes=data.include_suffixes, exclude_suffixes=data.exclude_suffixes,
        min_size=data.min_size, max_size=data.max_size,
        modified_after=data.modified_after or None, modified_before=data.modified_before or None,
        status="pending", prefix_queue=json.dumps(queue, ensure_ascii=False), listing_done=not queue,
        pending_keys=json.dumps(selected, ensure_ascii=False), failed_items="[]",
        total_count=len(selected), total_bytes=sum(i["size"] for i in selected),
        done_count=0, skipped_count=0, failed_count=0, verified_count=0, bytes_transferred=0, processed_bytes=0,
        logs=json.dumps([s3.now_log("info", "任务已创建")], ensure_ascii=False), locked_until=0,
    )
    db.add(t)
    await db.commit()
    task_id = t.id
    spawn(task_id, user.id)
    return {"id": task_id}


@router.get("/tasks")
async def list_tasks(db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    rows = (await db.scalars(select(Migration_tasks).where(
        Migration_tasks.user_id == user.id).order_by(Migration_tasks.id.desc()).limit(100))).all()
    items = []
    for t in rows:
        o = task_out(t)
        o.update({k: getattr(t, k) for k in (
            "name", "source_id", "target_id", "source_prefix", "target_prefix", "sync_mode", "verify",
            "concurrency", "bandwidth_mbps", "include_suffixes", "exclude_suffixes")})
        o["locked"] = (t.locked_until or 0) > time.time()
        items.append(o)
    return {"items": items, "now": time.time()}


@router.post("/tasks/{task_id}/step")
async def step(task_id: int, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    return await run_step(db, task_id, user.id)


@router.post("/tasks/{task_id}/cancel")
async def cancel(task_id: int, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    t = await load_task(db, task_id, user.id)
    if t.status in ACTIVE:
        t.status = "cancelled"
        add_logs(t, [s3.now_log("warn", "任务已取消")])
    out = task_out(t)
    await db.commit()
    return out


@router.post("/tasks/{task_id}/retry")
async def retry(task_id: int, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    """Re-queue failed objects and resume a cancelled/failed/completed task."""
    t = await load_task(db, task_id, user.id)
    if t.status in ACTIVE:
        raise HTTPException(status_code=400, detail="任务正在运行")
    failed = s3.loads_list(t.failed_items)
    requeue = [{k: f.get(k) for k in ("key", "size", "etag", "mtime")} for f in failed]
    t.processed_bytes = max(0, (t.processed_bytes or 0) - sum(f.get("size", 0) for f in failed))
    t.pending_keys = json.dumps(requeue + s3.loads_list(t.pending_keys), ensure_ascii=False)
    t.failed_items, t.failed_count, t.error_message = "[]", 0, None
    t.status, t.locked_until = "running", 0
    add_logs(t, [s3.now_log("info", f"继续/重试，重新排队 {len(requeue)} 个失败对象")])
    out = task_out(t)
    await db.commit()
    spawn(task_id, user.id)
    return out


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_current_user)):
    t = await load_task(db, task_id, user.id)
    if t.status in ACTIVE:
        raise HTTPException(status_code=400, detail="请先取消任务")
    await db.delete(t)
    await db.commit()
    return {"ok": True}
