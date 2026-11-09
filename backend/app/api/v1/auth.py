from typing import Annotated

from fastapi import APIRouter, Cookie, Response, status

from app.core.config import get_settings
from app.core.deps import CurrentUser, SessionDep, rate_limit
from app.core.errors import Unauthorized
from app.core.security import create_access_token
from app.schemas import LoginIn, RegisterIn, SessionOut, UserOut, WorkspaceIn, WorkspaceOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "nexus_refresh"


def _set_cookie(response: Response, raw: str) -> None:
    s = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        raw,
        max_age=s.refresh_token_ttl_days * 86400,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/api/v1/auth",
    )


async def _session_out(session: SessionDep, user) -> SessionOut:
    s = get_settings()
    ws = await auth_service.list_workspaces(session, user.id)
    return SessionOut(
        access_token=create_access_token(user.id),
        expires_in=s.access_token_ttl_minutes * 60,
        user=UserOut.model_validate(user),
        workspaces=[WorkspaceOut(id=w.id, name=w.name, slug=w.slug, role=r) for w, r in ws],
    )


@router.post("/register", response_model=SessionOut, status_code=status.HTTP_201_CREATED, dependencies=[rate_limit("auth", "rate_limit_auth")])
async def register(body: RegisterIn, response: Response, session: SessionDep) -> SessionOut:
    user = await auth_service.register(session, body.email, body.password, body.name, body.workspace_name)
    raw = await auth_service.issue_refresh(session, user.id)
    await session.commit()
    _set_cookie(response, raw)
    return await _session_out(session, user)


@router.post("/login", response_model=SessionOut, dependencies=[rate_limit("auth", "rate_limit_auth")])
async def login(body: LoginIn, response: Response, session: SessionDep) -> SessionOut:
    user = await auth_service.authenticate(session, body.email, body.password)
    raw = await auth_service.issue_refresh(session, user.id)
    await session.commit()
    _set_cookie(response, raw)
    return await _session_out(session, user)


@router.post("/refresh", response_model=SessionOut)
async def refresh(
    response: Response,
    session: SessionDep,
    nexus_refresh: Annotated[str | None, Cookie()] = None,
) -> SessionOut:
    if not nexus_refresh:
        raise Unauthorized("Sign in to continue.", code="no_session")
    user, raw = await auth_service.rotate_refresh(session, nexus_refresh)
    await session.commit()
    _set_cookie(response, raw)
    return await _session_out(session, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response, session: SessionDep, nexus_refresh: Annotated[str | None, Cookie()] = None) -> None:
    if nexus_refresh:
        await auth_service.revoke_refresh(session, nexus_refresh)
        await session.commit()
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me", response_model=SessionOut)
async def me(user: CurrentUser, session: SessionDep) -> SessionOut:
    return await _session_out(session, user)


ws_router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@ws_router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(user: CurrentUser, session: SessionDep) -> list[WorkspaceOut]:
    rows = await auth_service.list_workspaces(session, user.id)
    return [WorkspaceOut(id=w.id, name=w.name, slug=w.slug, role=r) for w, r in rows]


@ws_router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(body: WorkspaceIn, user: CurrentUser, session: SessionDep) -> WorkspaceOut:
    ws = await auth_service.create_workspace(session, user, body.name)
    await session.commit()
    return WorkspaceOut(id=ws.id, name=ws.name, slug=ws.slug, role="owner")
