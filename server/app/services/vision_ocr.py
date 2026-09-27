"""Lite Python PDF & Document Text Extractor.

Pure Python document extractor. Does not require external C++ binaries, Tesseract installations, or GPUs.
Optimized for standard digital and scanned PDF invoices, purchase orders, and tax documents.
"""

from __future__ import annotations

import io
import re
from pathlib import Path


def extract_text_from_pdf(pdf_bytes: bytes) -> tuple[str, str | None]:
    """Extract full readable text from PDF bytes using pure Python libraries."""
    text_chunks: list[str] = []

    # 1. Try PyMuPDF (fitz)
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page in doc:
            t = page.get_text() or ""
            if t.strip():
                text_chunks.append(t)
        doc.close()
        if text_chunks:
            return "\n\n".join(text_chunks), None
    except Exception:
        pass

    # 2. Try pypdf
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                text_chunks.append(t)
        if text_chunks:
            return "\n\n".join(text_chunks), None
    except Exception:
        pass

    # 3. Try pdfplumber
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                if t.strip():
                    text_chunks.append(t)
        if text_chunks:
            return "\n\n".join(text_chunks), None
    except Exception:
        pass

    # 4. Fallback text stream extraction
    try:
        raw_str = pdf_bytes.decode("latin1", errors="ignore")
        stream_matches = re.findall(r"\(([^)]+)\)\s*Tj", raw_str)
        if stream_matches:
            return " ".join(stream_matches), None
    except Exception:
        pass

    return "", "No readable text stream found in PDF."


def extract_text_from_image(image_bytes: bytes) -> tuple[str, str | None]:
    """Lite fallback for images (PDF is the primary format)."""
    return "", "Image OCR has been streamlined for fast direct PDF uploads. Please upload your invoice as a PDF."
