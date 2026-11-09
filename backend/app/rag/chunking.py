"""Recursive, token-aware chunking that keeps paragraphs and sentences intact when it can."""

import re
from dataclasses import dataclass
from functools import lru_cache

import tiktoken

from app.rag.parsing import Page

SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "]


@lru_cache
def _enc() -> tiktoken.Encoding:
    return tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    return len(_enc().encode(text, disallowed_special=()))


@dataclass
class TextChunk:
    ordinal: int
    page: int | None
    content: str
    token_count: int


def _split(text: str, max_tokens: int, seps: list[str]) -> list[str]:
    if count_tokens(text) <= max_tokens:
        return [text]
    if not seps:  # hard split on tokens
        toks = _enc().encode(text, disallowed_special=())
        return [_enc().decode(toks[i : i + max_tokens]) for i in range(0, len(toks), max_tokens)]
    sep, rest = seps[0], seps[1:]
    parts = [p for p in text.split(sep) if p.strip()]
    if len(parts) == 1:
        return _split(text, max_tokens, rest)
    out: list[str] = []
    for i, p in enumerate(parts):
        piece = p + (sep if i < len(parts) - 1 and sep.strip() in ".?!;," else "")
        out.extend(_split(piece, max_tokens, rest))
    return out


def _normalise(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_pages(pages: list[Page], max_tokens: int = 400, overlap_tokens: int = 60) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    ordinal = 0
    for page in pages:
        pieces = _split(_normalise(page.text), max_tokens, SEPARATORS)
        buf: list[str] = []
        buf_tokens = 0
        for piece in pieces:
            t = count_tokens(piece)
            if buf and buf_tokens + t > max_tokens:
                content = " ".join(buf).strip()
                chunks.append(TextChunk(ordinal, page.number, content, count_tokens(content)))
                ordinal += 1
                # carry the tail of the previous chunk forward as overlap
                tail: list[str] = []
                tail_tokens = 0
                for prev in reversed(buf):
                    pt = count_tokens(prev)
                    if tail_tokens + pt > overlap_tokens:
                        break
                    tail.insert(0, prev)
                    tail_tokens += pt
                buf, buf_tokens = tail, tail_tokens
            buf.append(piece.strip())
            buf_tokens += t
        if buf:
            content = " ".join(buf).strip()
            if content:
                chunks.append(TextChunk(ordinal, page.number, content, count_tokens(content)))
                ordinal += 1
    return chunks
