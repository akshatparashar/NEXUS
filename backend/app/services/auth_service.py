import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import Conflict, Unauthorized
from app.core.security import hash_password, hash_refresh_token, new_refresh_token, verify_password
from app.models import Membership, RefreshToken, User, Workflow, Workspace
from app.services.templates import TEMPLATES


def _slug(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "workspace"
    return f"{base}-{secrets.token_hex(3)}"


async def create_workspace(session: AsyncSession, user: User, name: str) -> Workspace:
    ws = Workspace(name=name.strip()[:80], slug=_slug(name))
    session.add(ws)
    await session.flush()
    session.add(Membership(user_id=user.id, workspace_id=ws.id, role="owner"))
    for t in TEMPLATES:
        session.add(
            Workflow(
                workspace_id=ws.id,
                name=t["name"],
                description=t["description"],
                graph=t["graph"],
                created_by=user.id,
            )
        )
    return ws


async def register(session: AsyncSession, email: str, password: str, name: str, workspace_name: str | None) -> User:
    email = email.lower().strip()
    if (await session.execute(select(User).where(User.email == email))).scalar_one_or_none():
        raise Conflict("An account with this email already exists. Sign in instead.", code="email_taken")
    user = User(email=email, name=name.strip(), password_hash=hash_password(password))
    session.add(user)
    await session.flush()
    await create_workspace(session, user, workspace_name or f"{name.split()[0]}'s workspace")
    return user


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    user = (await session.execute(select(User).where(User.email == email.lower().strip()))).scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        raise Unauthorized("Email or password is incorrect.", code="invalid_credentials")
    return user


async def issue_refresh(session: AsyncSession, user_id: uuid.UUID) -> str:
    raw, digest = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=digest,
            expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_ttl_days),
        )
    )
    return raw


async def rotate_refresh(session: AsyncSession, raw: str) -> tuple[User, str]:
    """Refresh tokens are single-use: each refresh revokes the old one and issues a new one."""
    tok = (
        await session.execute(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
    ).scalar_one_or_none()
    if tok is None or tok.expires_at < datetime.now(UTC):
        raise Unauthorized("Your session ended. Sign in again.", code="refresh_invalid")
    if tok.revoked:
        # Reuse of a revoked token: assume theft and end every session for this user.
        await session.execute(update(RefreshToken).where(RefreshToken.user_id == tok.user_id).values(revoked=True))
        await session.commit()
        raise Unauthorized("Your session ended. Sign in again.", code="refresh_reused")
    tok.revoked = True
    user = await session.get(User, tok.user_id)
    if user is None:
        raise Unauthorized("Account not found.")
    return user, await issue_refresh(session, user.id)


async def revoke_refresh(session: AsyncSession, raw: str) -> None:
    await session.execute(
        update(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)).values(revoked=True)
    )


async def list_workspaces(session: AsyncSession, user_id: uuid.UUID) -> list[tuple[Workspace, str]]:
    rows = await session.execute(
        select(Workspace, Membership.role)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == user_id)
        .order_by(Workspace.created_at)
    )
    return [(w, r) for w, r in rows.all()]
