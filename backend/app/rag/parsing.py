import io
from dataclasses import dataclass

from pypdf import PdfReader

ALLOWED_TYPES = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
}


@dataclass
class Page:
    number: int | None
    text: str


class UnsupportedDocument(ValueError):
    pass


def sniff_type(filename: str, head: bytes) -> str:
    """Decide the type from the extension *and* the bytes. A renamed binary never passes as text."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_TYPES:
        raise UnsupportedDocument("Only PDF, TXT and Markdown files can be added.")
    if ext == ".pdf":
        if not head.startswith(b"%PDF-"):
            raise UnsupportedDocument("This file has a .pdf name but is not a PDF.")
        return ALLOWED_TYPES[ext]
    if b"\x00" in head:
        raise UnsupportedDocument("This file has a text extension but contains binary data.")
    try:
        head.decode("utf-8")
    except UnicodeDecodeError:
        # A truncated multi-byte sequence at the end of the sample is fine.
        try:
            head[:-4].decode("utf-8")
        except UnicodeDecodeError as e:
            raise UnsupportedDocument("Text files must be UTF-8 encoded.") from e
    return ALLOWED_TYPES[ext]


def parse(data: bytes, mime: str) -> list[Page]:
    if mime == "application/pdf":
        reader = PdfReader(io.BytesIO(data))
        pages = []
        for i, p in enumerate(reader.pages, start=1):
            text = (p.extract_text() or "").strip()
            if text:
                pages.append(Page(i, text))
        if not pages:
            raise UnsupportedDocument("No text could be extracted. Scanned PDFs need OCR first.")
        return pages
    text = data.decode("utf-8", errors="replace").strip()
    if not text:
        raise UnsupportedDocument("The file is empty.")
    return [Page(None, text)]
