import hashlib
import hmac
import os
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import create_access_token
from core.database import get_db
from models.app_accounts import App_accounts
from models.auth import User
from dependencies.app_user import get_app_user
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/s3/account", tags=["s3-account"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.@-]{3,32}$")
ITERATIONS = 200_000
TOKEN_MINUTES = 60 * 24 * 7


DEFAULT_ADMIN_USERNAME = "demo"
DEFAULT_ADMIN_PASSWORD = "demo123"


async def ensure_default_admin(db: AsyncSession) -> None:
    """Idempotently seed the default admin account so a fresh deployment is usable."""
    exists = await db.scalar(select(App_accounts.id).where(App_accounts.username == DEFAULT_ADMIN_USERNAME))
    if exists:
        return
    user_id = f"local:{DEFAULT_ADMIN_USERNAME}"
    db.add(App_accounts(username=DEFAULT_ADMIN_USERNAME, password_hash=hash_password(DEFAULT_ADMIN_PASSWORD),
                        account_user_id=user_id))
    row = await db.get(User, user_id)
    if row is None:
        db.add(User(id=user_id, email=DEFAULT_ADMIN_USERNAME, name=DEFAULT_ADMIN_USERNAME, role="admin"))
    else:
        row.role = "admin"
    try:
        await db.commit()
    except Exception:  # noqa: BLE001 - concurrent first logins may race; the other one wins
        await db.rollback()


class Credentials(BaseModel):
    username: str
    password: str


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(calc.hex(), digest)
    except (ValueError, TypeError):
        return False


async def issue(db: AsyncSession, user_id: str, username: str) -> dict:
    row = await db.get(User, user_id)
    role = (row.role if row else None) or "user"
    await db.commit()
    if role == "disabled":
        raise HTTPException(status_code=403, detail="账号已被管理员禁用")
    token = create_access_token({"sub": user_id, "email": username, "name": username, "role": "user"},
                                expires_minutes=TOKEN_MINUTES)
    return {"token": token, "username": username}


@router.post("/register")
async def register(data: Credentials, db: AsyncSession = Depends(get_db)):
    await ensure_default_admin(db)
    username = data.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="用户名需为 3-32 位字母、数字或 _ . @ -")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    exists = await db.scalar(select(App_accounts.id).where(App_accounts.username == username))
    if exists:
        raise HTTPException(status_code=400, detail="用户名已被注册")
    user_id = f"local:{username}"
    db.add(App_accounts(username=username, password_hash=hash_password(data.password), account_user_id=user_id))
    await db.commit()
    return await issue(db, user_id, username)


@router.post("/login")
async def login(data: Credentials, db: AsyncSession = Depends(get_db)):
    await ensure_default_admin(db)
    username = data.username.strip()
    acc = await db.scalar(select(App_accounts).where(App_accounts.username == username))
    if not acc or not verify_password(data.password, acc.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return await issue(db, acc.account_user_id, username)


class ChangePassword(BaseModel):
    old_password: str
    new_password: str


@router.post("/change_password")
async def change_password(
    data: ChangePassword, db: AsyncSession = Depends(get_db), user: UserResponse = Depends(get_app_user)
):
    acc = await db.scalar(select(App_accounts).where(App_accounts.account_user_id == user.id))
    if not acc:
        raise HTTPException(status_code=400, detail="当前账号不是用户名密码账号，无法修改密码")
    if not verify_password(data.old_password, acc.password_hash):
        raise HTTPException(status_code=400, detail="原密码错误")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    acc.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"ok": True}
