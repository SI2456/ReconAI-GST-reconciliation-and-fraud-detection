"""Blurry, blank or damaged invoice uploads are rejected with a clear re-upload message.

Scans are generated from the mock invoices: each page is rendered to an image (optionally
blurred) and saved as an image-only PDF, like a scanner would produce.
"""
import io
from pathlib import Path

import pytest
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DIGITAL_INVOICE = next((ROOT / "reconai_dummy_data").rglob("invoices/*/KRN-26-27-0001.pdf"))
MALFORMED_INVOICE = next((ROOT / "reconai_dummy_data").rglob("MALFORMED_missing_invnum.pdf"))
PHOTO_INVOICE = ROOT / "sample_data" / "invoice_demo.jpg"


def scanned_pdf(source: Path, blur_radius: float = 0.0, dpi: int = 200) -> bytes:
    import pymupdf

    with pymupdf.open(source) as doc:
        png = doc[0].get_pixmap(dpi=dpi).tobytes("png")
    image = Image.open(io.BytesIO(png)).convert("RGB")
    if blur_radius:
        image = image.filter(ImageFilter.GaussianBlur(blur_radius))
    out = io.BytesIO()
    image.save(out, "PDF", resolution=dpi)
    return out.getvalue()


def blank_pdf() -> bytes:
    import pymupdf

    with pymupdf.open() as doc:
        doc.new_page()
        return doc.tobytes()


def password_pdf() -> bytes:
    import pymupdf

    with pymupdf.open(DIGITAL_INVOICE) as doc:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="secret")


def damaged_pdf() -> bytes:
    return b"%PDF-1.4 this is not really a pdf"


def photo(blur_radius: float = 0.0, max_side: int | None = None) -> bytes:
    image = Image.open(PHOTO_INVOICE).convert("RGB")
    if max_side:
        image.thumbnail((max_side, max_side))
    if blur_radius:
        image = image.filter(ImageFilter.GaussianBlur(blur_radius))
    out = io.BytesIO()
    image.save(out, "JPEG", quality=90)
    return out.getvalue()


# Files are built inside each test (not at collection time) and parametrized by name only,
# so test IDs stay short.
READABLE = {
    "digital.pdf": lambda: DIGITAL_INVOICE.read_bytes(),
    "malformed-but-readable.pdf": lambda: MALFORMED_INVOICE.read_bytes(),
    "sharp-scan.pdf": lambda: scanned_pdf(DIGITAL_INVOICE),
    "slightly-soft-scan.pdf": lambda: scanned_pdf(DIGITAL_INVOICE, blur_radius=1.2),
    "photo.jpg": lambda: photo(),
}

UNREADABLE = {
    "blurry-scan.pdf": (lambda: scanned_pdf(DIGITAL_INVOICE, blur_radius=3.0), "too blurry"),
    "blank.pdf": (blank_pdf, "blank or too faint"),
    "damaged.pdf": (damaged_pdf, "could not be opened"),
    "locked.pdf": (password_pdf, "password-protected"),
    "blurry-photo.jpg": (lambda: photo(blur_radius=3.0), "too blurry"),
    "tiny-photo.jpg": (lambda: photo(max_side=400), "too small"),
}


# --- The check itself ------------------------------------------------------------------------

@pytest.mark.parametrize("name", list(READABLE))
def test_readable_documents_pass(name):
    from app.services.readability import check_invoice_readability

    assert check_invoice_readability(READABLE[name](), name) is None


@pytest.mark.parametrize("name", list(UNREADABLE))
def test_unreadable_documents_are_rejected(name):
    from app.services.readability import check_invoice_readability

    make_content, expected = UNREADABLE[name]
    message = check_invoice_readability(make_content(), name)
    assert message and expected in message
    # The frontend treats any error mentioning "token" as an expired session.
    assert "token" not in message.lower()


def test_non_scan_formats_are_not_checked():
    from app.services.readability import check_invoice_readability

    assert check_invoice_readability(b"invoice_number,total\nA1,100\n", "register.csv") is None


# --- Through the upload API ----------------------------------------------------------------

def _upload_invoice(api, ws, filename: str, content: bytes, content_type: str = "application/pdf"):
    return api.post(
        "/api/ingestion/upload",
        headers=ws.headers,
        data={"clientId": ws.client_id, "document_type": "TAX_INVOICE", "gstin": ws.gstin, "tax_periods": "04-2026"},
        files={"file": (filename, content, content_type)},
    )


def _stored_files() -> set[Path]:
    from app.core.config import settings

    root = Path(settings.upload_dir)  # a temp dir during tests (see conftest.py)
    return set(root.rglob("*")) if root.exists() else set()


def test_blurry_upload_is_rejected_and_nothing_is_saved(api, new_client_workspace):
    ws = new_client_workspace("BlurryUploader")
    uploads_before = api.get("/api/ingestion/uploads", headers=ws.headers).json()["uploads"]
    files_before = _stored_files()

    r = _upload_invoice(api, ws, "scan.pdf", scanned_pdf(DIGITAL_INVOICE, blur_radius=3.0))

    assert r.status_code == 422
    assert "too blurry" in r.json()["detail"] and "re-upload" in r.json()["detail"]
    assert api.get("/api/ingestion/uploads", headers=ws.headers).json()["uploads"] == uploads_before
    assert _stored_files() == files_before


def test_readable_uploads_are_accepted(api, new_client_workspace):
    ws = new_client_workspace("ClearUploader")
    for filename, content in [
        ("KRN-26-27-0001.pdf", DIGITAL_INVOICE.read_bytes()),
        ("MALFORMED_missing_invnum.pdf", MALFORMED_INVOICE.read_bytes()),
        ("sharp-scan.pdf", scanned_pdf(DIGITAL_INVOICE)),
    ]:
        r = _upload_invoice(api, ws, filename, content)
        assert r.status_code == 201, f"{filename}: {r.status_code} {r.text[:200]}"
