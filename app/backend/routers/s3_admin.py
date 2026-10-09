import json
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.app_user import ROLES, get_app_admin, get_app_user
from models.auth import User
from models.app_accounts import App_accounts
from routers.s3_account import hash_password
from models.migration_tasks import Migration_tasks
from models.storage_connections import Storage_connections
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/s3", tags=["s3-admin"])

ACTIVE = ("pending", "running")


class RoleIn(BaseModel):
    role: str


@router.get("/me")
async def me(user: UserResponse = Depends(get_app_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


@router.get("/admin/users")
async def list_users(db: AsyncSession = Depends(get_db), _: UserResponse = Depends(get_app_admin)):
    users = (await db.scalars(select(User).order_by(User.created_at))).all()
    conn_counts = dict((await db.execute(
        select(Storage_connections.user_id, func.count()).group_by(Storage_connections.user_id))).all())
    task_counts = dict((await db.execute(
        select(Migration_tasks.user_id, func.count()).group_by(Migration_tasks.user_id))).all())
    accounts = {a.account_user_id: a.username for a in (await db.scalars(select(App_accounts))).all()}
    items = [{
        "id": u.id, "email": u.email, "name": u.name, "role": u.role or "user",
        "username": accounts.get(u.id),
        "created_at": u.created_at.isoformat() if u.created_at else None,
        "last_login": u.last_login.isoformat() if u.last_login else None,
        "connections": conn_counts.get(u.id, 0), "tasks": task_counts.get(u.id, 0),
    } for u in users]
    return {"items": items}


@router.post("/admin/users/{user_id}/role")
async def set_role(
    user_id: str, data: RoleIn, db: AsyncSession = Depends(get_db), admin: UserResponse = Depends(get_app_admin)
):
    if data.role not in ROLES:
        raise HTTPException(status_code=400, detail="无效的角色")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    target.role = data.role
    cancelled = 0
    if data.role == "disabled":
        tasks = (await db.scalars(select(Migration_tasks).where(
            Migration_tasks.user_id == user_id, Migration_tasks.status.in_(ACTIVE)))).all()
        for t in tasks:
            t.status = "cancelled"
            logs = json.loads(t.logs or "[]")
            logs.append({"t": time.time(), "level": "warn", "msg": "用户被禁用，任务已由管理员取消"})
            t.logs = json.dumps(logs[-300:], ensure_ascii=False)
            cancelled += 1
    await db.commit()
    return {"ok": True, "role": data.role, "cancelled_tasks": cancelled}


@router.get("/admin/tasks")
async def all_tasks(db: AsyncSession = Depends(get_db), _: UserResponse = Depends(get_app_admin)):
    tasks = (await db.scalars(select(Migration_tasks).order_by(Migration_tasks.id.desc()).limit(300))).all()
    users = {u.id: u for u in (await db.scalars(select(User))).all()}
    conns = {c.id: c for c in (await db.scalars(select(Storage_connections))).all()}

    def cname(cid):
        c = conns.get(cid)
        return f"{c.name}（{c.bucket}）" if c else f"#{cid}（已删除）"

    items = [{
        "id": t.id, "name": t.name, "status": t.status,
        "user_email": (users.get(t.user_id).email if users.get(t.user_id) else "") or t.user_id,
        "source": cname(t.source_id), "target": cname(t.target_id),
        "source_prefix": t.source_prefix or "", "target_prefix": t.target_prefix or "",
        "total_count": t.total_count or 0, "done_count": t.done_count or 0,
        "skipped_count": t.skipped_count or 0, "failed_count": t.failed_count or 0,
        "total_bytes": t.total_bytes or 0, "processed_bytes": t.processed_bytes or 0,
        "bytes_transferred": t.bytes_transferred or 0, "listing_done": bool(t.listing_done),
        "error_message": t.error_message,
        "created_at": t.created_at.isoformat() if getattr(t, "created_at", None) else None,
    } for t in tasks]
    return {"items": items}


class ResetPasswordIn(BaseModel):
    new_password: str


async def _non_admin_target(db: AsyncSession, user_id: str, admin: UserResponse) -> User:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="不能对自己执行此操作")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if (target.role or "user") == "admin":
        raise HTTPException(status_code=403, detail="不能操作其他管理员，请先取消其管理员身份")
    return target


@router.post("/admin/users/{user_id}/password")
async def reset_password(
    user_id: str, data: ResetPasswordIn, db: AsyncSession = Depends(get_db), admin: UserResponse = Depends(get_app_admin)
):
    await _non_admin_target(db, user_id, admin)
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    acc = await db.scalar(select(App_accounts).where(App_accounts.account_user_id == user_id))
    if not acc:
        raise HTTPException(status_code=400, detail="该用户不是用户名密码账号，无法重置密码")
    acc.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"ok": True}


@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, db: AsyncSession = Depends(get_db), admin: UserResponse = Depends(get_app_admin)):
    """Delete a non-admin user together with their connections, tasks and login account."""
    target = await _non_admin_target(db, user_id, admin)
    counts = {}
    for model, key in ((Migration_tasks, "tasks"), (Storage_connections, "connections"), (App_accounts, None)):
        col = model.account_user_id if model is App_accounts else model.user_id
        rows = (await db.scalars(select(model).where(col == user_id))).all()
        for r in rows:
            await db.delete(r)
        if key:
            counts[key] = len(rows)
    await db.delete(target)
    await db.commit()
    return {"ok": True, **counts}
