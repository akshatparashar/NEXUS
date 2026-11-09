import asyncio
from functools import lru_cache

from app.core.config import get_settings
from app.core.errors import ServiceUnavailable
from app.core.logging import get_logger

log = get_logger(__name__)


class Embedder:
    dim: int

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed_documents([text]))[0]


class LocalEmbedder(Embedder):
    """BAAI/bge-small-en-v1.5 on CPU via fastembed (ONNX). Free, private, 384 dimensions."""

    def __init__(self, model: str, cache_dir: str, dim: int) -> None:
        from fastembed import TextEmbedding

        self.dim = dim
        self._model = TextEmbedding(model_name=model, cache_dir=cache_dir)

    def _embed(self, texts: list[str]) -> list[list[float]]:
        return [v.tolist() for v in self._model.embed(texts, batch_size=32)]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.to_thread(self._embed, texts)

    async def embed_query(self, text: str) -> list[float]:
        # bge models retrieve better with this instruction on the query side
        return (await self.embed_documents([f"Represent this sentence for searching relevant passages: {text}"]))[0]


class OpenAIEmbedder(Embedder):
    def __init__(self, dim: int) -> None:
        from langchain_openai import OpenAIEmbeddings

        s = get_settings()
        self.dim = dim
        self._client = OpenAIEmbeddings(
            model="text-embedding-3-small",
            dimensions=dim,
            api_key=s.openai_api_key,
            base_url=s.openai_base_url,
        )

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._client.aembed_documents(texts)


class GoogleEmbedder(Embedder):
    """Gemini embeddings at the database's dimension (gemini-embedding-001 supports any size).

    Uses the Gemini key, so it needs no model download: the right choice on serverless hosts.
    """

    def __init__(self, dim: int) -> None:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        self.dim = dim
        self._client = GoogleGenerativeAIEmbeddings(model="models/gemini-embedding-001", google_api_key=get_settings().google_api_key)

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._client.aembed_documents(texts, task_type="RETRIEVAL_DOCUMENT", output_dimensionality=self.dim)

    async def embed_query(self, text: str) -> list[float]:
        return (await self._client.aembed_documents([text], task_type="RETRIEVAL_QUERY", output_dimensionality=self.dim))[0]


_override: Embedder | None = None


def set_embedder(e: Embedder | None) -> None:
    global _override
    _override = e
    _default.cache_clear()


@lru_cache
def _default() -> Embedder:
    s = get_settings()
    if s.embedding_provider == "google":
        if not s.google_api_key:
            raise ServiceUnavailable("EMBEDDING_PROVIDER=google needs GOOGLE_API_KEY.", code="embeddings_unconfigured")
        return GoogleEmbedder(s.embedding_dim)
    if s.embedding_provider == "openai":
        if not s.openai_api_key:
            raise ServiceUnavailable("EMBEDDING_PROVIDER=openai needs OPENAI_API_KEY.", code="embeddings_unconfigured")
        return OpenAIEmbedder(s.embedding_dim)
    log.info("loading_local_embedding_model", model=s.embedding_model)
    return LocalEmbedder(s.embedding_model, s.model_cache_dir, s.embedding_dim)


def get_embedder() -> Embedder:
    return _override or _default()
