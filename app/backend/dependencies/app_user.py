"""Application-level role resolution on top of the platform login.

Roles are stored in the built-in ``users`` table: ``user`` / ``admin`` / ``disabled``.
The first user to use the app (or the platform owner) becomes ``admin``.
"""
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from models.auth import User
from schemas.auth import UserResponse

ROLES = ("user", "admin", "disabled")


async def get_app_user(
    current: UserResponse = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> UserResponse:
    row = await db.get(User, current.id)
    now = datetime.now(timezone.utc)
    if row is None:
        has_admin = await db.scalar(select(User.id).where(User.role == "admin").limit(1))
        role = "admin" if current.role == "admin" or not has_admin else "user"
        row = User(id=current.id, email=current.email or "", name=current.name, role=role, last_login=now)
        db.add(row)
    else:
        if current.role == "admin" and row.role == "user":
            row.role = "admin"
        if current.email and not row.email:
            row.email = current.email
        row.last_login = now
    role = row.role or "user"
    await db.commit()
    if role == "disabled":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已被管理员禁用")
    return current.model_copy(update={"role": role})


async def get_app_admin(user: UserResponse = Depends(get_app_user)) -> UserResponse:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user
