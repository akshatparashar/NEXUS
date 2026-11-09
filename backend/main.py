"""Vercel entrypoint: the FastAPI app (see vercel.json, service "api")."""

from app.main import app

__all__ = ["app"]
