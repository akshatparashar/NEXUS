"""Provider-agnostic LLM access.

Agents talk to :class:`LLMClient`, never to a provider SDK. The production implementation uses
LangChain's ``init_chat_model`` so OpenAI, Anthropic and Ollama are interchangeable through config.

Structured outputs are produced by forcing a single tool call whose JSON schema is the Pydantic
model. While the arguments stream in we parse the partial JSON and forward growth of one text field
(``summary``) as token deltas, so the UI streams the agent's prose while we still get validated,
typed output at the end.
"""

import copy
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.core.config import get_settings
from app.core.errors import ServiceUnavailable
from app.core.logging import get_logger

log = get_logger(__name__)

T = TypeVar("T", bound=BaseModel)
DeltaFn = Callable[[str], Awaitable[None]]


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0

    def __add__(self, other: "Usage") -> "Usage":
        return Usage(self.input_tokens + other.input_tokens, self.output_tokens + other.output_tokens)


class LLMNotConfigured(ServiceUnavailable):
    code = "llm_not_configured"


class TransientLLMError(Exception):
    """Worth retrying: rate limits, timeouts, connection resets, 5xx."""


class LLMClient:
    provider: str = "base"
    model: str = ""

    async def structured(
        self,
        schema: type[T],
        system: str,
        user: str,
        *,
        on_delta: DeltaFn | None = None,
        stream_field: str = "summary",
        temperature: float | None = None,
        model: str | None = None,
    ) -> tuple[T, Usage]:
        raise NotImplementedError

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        on_delta: DeltaFn | None = None,
        temperature: float | None = None,
        model: str | None = None,
    ) -> tuple[str, Usage]:
        raise NotImplementedError


def _inline_refs(schema: dict) -> dict:
    """Inline $defs so every provider accepts the schema (some reject $ref in tool parameters)."""
    schema = copy.deepcopy(schema)
    defs = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].rsplit("/", 1)[-1]
                return resolve(copy.deepcopy(defs[name]))
            return {k: resolve(v) for k, v in node.items() if k != "title"}
        if isinstance(node, list):
            return [resolve(x) for x in node]
        return node

    return resolve(schema)


def tool_spec(schema: type[BaseModel]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": schema.__name__,
            "description": (schema.__doc__ or schema.__name__).strip(),
            "parameters": _inline_refs(schema.model_json_schema()),
        },
    }


def _classify(e: Exception) -> Exception:
    name = type(e).__name__.lower()
    msg = str(e).lower()
    transient_markers = ("ratelimit", "timeout", "connection", "apierror", "overloaded", "internalserver", "503", "502", "529")
    if any(m in name or m in msg for m in transient_markers) and "authentication" not in name:
        return TransientLLMError(f"{type(e).__name__}: {e}")
    if "authentication" in name or "401" in msg or "invalid api key" in msg or "incorrect api key" in msg:
        return LLMNotConfigured(f"The {get_settings().llm_provider} API key was rejected. Check your .env.")
    return e


class LangChainLLM(LLMClient):
    def __init__(self) -> None:
        s = get_settings()
        if not s.llm_configured:
            raise LLMNotConfigured(
                f"No API key for LLM_PROVIDER={s.llm_provider}. Add it to .env, or set LLM_PROVIDER=ollama "
                "to run a local model for free."
            )
        self.provider = s.llm_provider
        self.model = s.llm_model
        self._cache: dict[tuple[str, float], Any] = {}

    def _model(self, model: str | None, temperature: float | None) -> Any:
        from langchain.chat_models import init_chat_model

        s = get_settings()
        name = model or s.llm_model
        temp = s.llm_temperature if temperature is None else temperature
        key = (name, temp)
        if key not in self._cache:
            kwargs: dict[str, Any] = {"temperature": temp, "timeout": s.node_timeout_seconds, "max_retries": 1}
            if s.llm_provider == "openai":
                kwargs.update(api_key=s.openai_api_key, stream_usage=True)
                if s.openai_base_url:
                    kwargs["base_url"] = s.openai_base_url
            elif s.llm_provider == "anthropic":
                kwargs.update(api_key=s.anthropic_api_key, max_tokens=4096)
            else:
                kwargs.pop("timeout")
                kwargs.update(base_url=s.ollama_base_url)
            self._cache[key] = init_chat_model(name, model_provider=s.llm_provider, **kwargs)
        return self._cache[key]

    async def structured(
        self,
        schema: type[T],
        system: str,
        user: str,
        *,
        on_delta: DeltaFn | None = None,
        stream_field: str = "summary",
        temperature: float | None = None,
        model: str | None = None,
    ) -> tuple[T, Usage]:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_core.utils.json import parse_partial_json

        llm = self._model(model, temperature).bind_tools([tool_spec(schema)], tool_choice=schema.__name__)
        messages: list[Any] = [SystemMessage(system), HumanMessage(user)]
        usage = Usage()

        for attempt in range(2):  # one repair round if the model returns invalid arguments
            acc = None
            emitted = 0
            try:
                async for chunk in llm.astream(messages):
                    acc = chunk if acc is None else acc + chunk
                    if on_delta and acc.tool_call_chunks:
                        raw = acc.tool_call_chunks[0].get("args") or ""
                        partial = parse_partial_json(raw) if raw else None
                        text = partial.get(stream_field) if isinstance(partial, dict) else None
                        if isinstance(text, str) and len(text) > emitted:
                            await on_delta(text[emitted:])
                            emitted = len(text)
            except Exception as e:
                raise _classify(e) from e
            if acc is None:
                raise TransientLLMError("The model returned an empty response.")
            if acc.usage_metadata:
                usage = usage + Usage(acc.usage_metadata.get("input_tokens", 0), acc.usage_metadata.get("output_tokens", 0))

            args: Any = acc.tool_calls[0]["args"] if acc.tool_calls else None
            if args is None and isinstance(acc.content, str) and acc.content.strip().startswith("{"):
                try:
                    args = json.loads(acc.content)
                except json.JSONDecodeError:
                    args = None
            try:
                if args is None:
                    raise ValueError("no structured output was returned")
                return schema.model_validate(args), usage
            except (ValidationError, ValueError) as e:
                log.warning("structured_output_invalid", schema=schema.__name__, attempt=attempt, error=str(e)[:300])
                messages = [
                    *messages,
                    HumanMessage(
                        f"Your previous output did not match the {schema.__name__} schema: {str(e)[:800]}. "
                        f"Call {schema.__name__} again with valid arguments."
                    ),
                ]
        raise ValueError(f"The model could not produce a valid {schema.__name__} after a repair attempt.")

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        on_delta: DeltaFn | None = None,
        temperature: float | None = None,
        model: str | None = None,
    ) -> tuple[str, Usage]:
        llm = self._model(model, temperature)
        acc = None
        try:
            async for chunk in llm.astream([(m["role"], m["content"]) for m in messages]):
                acc = chunk if acc is None else acc + chunk
                text = chunk.content if isinstance(chunk.content, str) else "".join(
                    p.get("text", "") for p in chunk.content if isinstance(p, dict)
                )
                if text and on_delta:
                    await on_delta(text)
        except Exception as e:
            raise _classify(e) from e
        if acc is None:
            return "", Usage()
        content = acc.content if isinstance(acc.content, str) else "".join(
            p.get("text", "") for p in acc.content if isinstance(p, dict)
        )
        u = acc.usage_metadata or {}
        return content, Usage(u.get("input_tokens", 0), u.get("output_tokens", 0))


_override: LLMClient | None = None
_default: LLMClient | None = None


def set_llm(client: LLMClient | None) -> None:
    global _override
    _override = client


def get_llm() -> LLMClient:
    global _default
    if _override is not None:
        return _override
    if _default is None:
        _default = LangChainLLM()
    return _default


def reset_llm() -> None:
    global _default
    _default = None
