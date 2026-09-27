"""Upload-time readability check for invoice and purchase-order scans and photos.

Digital PDFs (with a text layer) are always readable. Scanned pages and photos are rendered
to grayscale and scored for sharpness: the median Laplacian variance over tiles that contain
ink, so blank paper doesn't dilute the score. The threshold was calibrated on the mock
invoices: sharp scans score about 2,000-4,600; at a score of about 25, GSTIN and amount digits
(5/6/8) are no longer reliably readable.

Missing *fields* are not checked here. A readable invoice with, say, no invoice number is still
accepted and flagged later in review.
"""

from __future__ import annotations

import io
import re

import numpy as np

SHARPNESS_THRESHOLD = 35.0
# Scale pages and photos so the long side is about A4 at 150 dpi, the scale used for calibration.
TARGET_LONG_SIDE_PX = 1754
MIN_IMAGE_LONG_SIDE_PX = 800
MAX_PAGES_CHECKED = 3
MIN_TEXT_LAYER_CHARS = 40  # alphanumeric characters that make a page count as digital
INK_TILE_PX = 64
INK_TILE_MIN_STD = 20.0

_RESCAN_HINT = "Please scan or photograph it again in good light, keep it in focus, and re-upload it."
_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")


def sharpness_score(gray: np.ndarray) -> tuple[float, int]:
    """Return (median Laplacian variance over inked tiles, number of inked tiles)."""
    img = gray.astype(np.float32)
    lap = img[:-2, 1:-1] + img[2:, 1:-1] + img[1:-1, :-2] + img[1:-1, 2:] - 4 * img[1:-1, 1:-1]
    t = INK_TILE_PX
    variances = [
        lap[y:y + t - 2, x:x + t - 2].var()
        for y in range(0, img.shape[0] - t, t)
        for x in range(0, img.shape[1] - t, t)
        if img[y:y + t, x:x + t].std() > INK_TILE_MIN_STD
    ]
    return (float(np.median(variances)) if variances else 0.0), len(variances)


def _page_problem(gray: np.ndarray, label: str) -> str | None:
    score, inked_tiles = sharpness_score(gray)
    if inked_tiles == 0:
        return f"{label} appears to be blank or too faint to read. {_RESCAN_HINT}"
    if score < SHARPNESS_THRESHOLD:
        return f"{label} is too blurry to read. {_RESCAN_HINT}"
    return None


def _check_pdf(content: bytes, label: str) -> str | None:
    import pymupdf

    try:
        doc = pymupdf.open(stream=content, filetype="pdf")
    except Exception:
        return "This PDF could not be opened. It may be damaged. Please re-upload the original file."
    with doc:
        if doc.needs_pass:
            return "This PDF is password-protected. Please remove the password and re-upload it."
        if doc.page_count == 0:
            return f"This PDF has no pages. Please re-upload the {label}."

        checked = min(doc.page_count, MAX_PAGES_CHECKED)
        blank_pages = 0
        for index in range(checked):
            page = doc[index]
            if len(re.sub(r"[\W_]", "", page.get_text())) >= MIN_TEXT_LAYER_CHARS:
                continue  # digital text layer: readable regardless of how it looks
            zoom = TARGET_LONG_SIDE_PX / max(page.rect.width, page.rect.height, 1)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
            gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width]
            page_label = f"This {label}" if doc.page_count == 1 else f"Page {index + 1} of this {label}"
            problem = _page_problem(gray, page_label)
            if problem and "blank" in problem:
                blank_pages += 1
            elif problem:
                return problem
        if blank_pages == checked:
            return f"This {label} appears to be blank or too faint to read. {_RESCAN_HINT}"
    return None


def _check_image(content: bytes) -> str | None:
    from PIL import Image

    try:
        img = Image.open(io.BytesIO(content))
        img.load()
    except Exception:
        return "This image could not be opened. It may be damaged. Please re-upload the original file."
    if max(img.size) < MIN_IMAGE_LONG_SIDE_PX:
        return (
            f"This image is too small to read ({img.width}x{img.height} pixels). "
            "Please re-upload a higher-resolution scan or photo."
        )
    gray = img.convert("L")
    gray.thumbnail((TARGET_LONG_SIDE_PX, TARGET_LONG_SIDE_PX))
    return _page_problem(np.asarray(gray), "This image")


def check_document_readability(
    content: bytes, filename: str, content_type: str = "", document_label: str = "invoice"
) -> str | None:
    """Return a message asking the client to re-upload, or None if the document is readable.

    `document_label` names the document in messages ("invoice", "purchase order").
    Only PDFs and images are checked; CSV/JSON uploads aren't scans.
    """
    name = (filename or "").lower()
    ctype = (content_type or "").lower()
    if name.endswith(".pdf") or "pdf" in ctype or content[:5] == b"%PDF-":
        return _check_pdf(content, document_label)
    if name.endswith(_IMAGE_EXTENSIONS) or ctype.startswith("image"):
        return _check_image(content)
    return None
