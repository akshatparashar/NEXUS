import time
import uuid
from collections import defaultdict
from typing import Annotated

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Forbidden, RateLimited, Unauthorized
from app.core.security import decode_access_token
from app.database.session import get_session
from app.events.pubsub import RedisPubSub, get_pubsub
from app.models import Membership, User, Workspace

bearer = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def current_user(
    session: SessionDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise Unauthorized("Sign in to continue.")
    user_id = decode_access_token(creds.credentials)
    user = await session.get(User, user_id)
    if user is None:
        raise Unauthorized("Account not found.")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


async def current_workspace(
    session: SessionDep,
    user: CurrentUser,
    x_workspace_id: Annotated[str | None, Header()] = None,
) -> Workspace:
    """Every scoped request names its workspace; membership is checked on every call."""
    q = select(Workspace).join(Membership, Membership.workspace_id == Workspace.id).where(Membership.user_id == user.id)
    if x_workspace_id:
        try:
            wid = uuid.UUID(x_workspace_id)
        except ValueError as e:
            raise Forbidden("Unknown workspace.") from e
        q = q.where(Workspace.id == wid)
    ws = (await session.execute(q.order_by(Workspace.created_at))).scalars().first()
    if ws is None:
        raise Forbidden("You do not have access to this workspace.")
    return ws


CurrentWorkspace = Annotated[Workspace, Depends(current_workspace)]


# --- rate limiting (fixed window; Redis when configured, in-process otherwise) ---------------

_local: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))


async def _hit(key: str, limit: int, window: int = 60) -> None:
    bucket = int(time.time() // window)
    ps = get_pubsub()
    if isinstance(ps, RedisPubSub):
        rkey = f"rl:{key}:{bucket}"
        n = await ps.client.incr(rkey)
        if n == 1:
            await ps.client.expire(rkey, window)
    else:
        b, n = _local[key]
        n = n + 1 if b == bucket else 1
        _local[key] = (bucket, n)
    if n > limit:
        raise RateLimited("Too many requests. Wait a moment and try again.")


def rate_limit(scope: str, limit_attr: str):
    async def dep(request: Request) -> None:
        from app.core.config import get_settings

        limit = getattr(get_settings(), limit_attr)
        ident = request.headers.get("authorization", "")[-24:] or (request.client.host if request.client else "anon")
        await _hit(f"{scope}:{ident}", limit)

    return Depends(dep)
