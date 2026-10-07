"""Point the backend at a throwaway SQLite database before any test imports it.

Settings, the database engine and the local upload folder are all created when the `app`
package is imported, so this has to run first. Nothing touches server/.env's database or
server/data/.
"""
import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_TMP = Path(tempfile.mkdtemp(prefix="reconai-tests-"))

# Environment variables take precedence over server/.env in pydantic-settings.
os.environ.update(
    DATABASE_URL=f"sqlite:///{(_TMP / 'test.sqlite3').as_posix()}",
    ENVIRONMENT="test",
    JWT_SECRET_KEY="test-only-secret",
    EMAIL_HOST="",
    EMAIL_HOST_USER="",
    R2_ENDPOINT_URL="",
    R2_ACCESS_KEY_ID="",
    R2_SECRET_ACCESS_KEY="",
    GEMINI_API_KEY="",  # never call the real Gemini API (or use a real key) from tests
    UPLOAD_DIR=str(_TMP / "uploads"),  # never write into the real server/data/uploads
)
os.chdir(_TMP)
sys.path.insert(0, str(ROOT / "server"))

atexit.register(shutil.rmtree, _TMP, ignore_errors=True)


import uuid  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402


@pytest.fixture(scope="session")
def api():
    from fastapi.testclient import TestClient
    from app.main import app

    return TestClient(app)


@pytest.fixture(scope="session")
def issued_otps():
    """Capture OTPs as they are generated (the API never returns them)."""
    import app.services.otp as otp_service

    issued: list[str] = []
    real_generate = otp_service.generate_otp

    def capture() -> str:
        issued.append(real_generate())
        return issued[-1]

    otp_service.generate_otp = capture
    yield issued
    otp_service.generate_otp = real_generate


@pytest.fixture(scope="session")
def new_client_workspace(api, issued_otps):
    """Factory: register and verify a fresh client; returns headers, client_id and gstin."""

    def create(name: str, gstin: str = "27AAACA1234F1Z5") -> SimpleNamespace:
        email = f"{name.lower()}-{uuid.uuid4().hex[:6]}@example.com"
        r = api.post("/api/auth/register", json={
            "name": name, "email": email, "password": "test-password",
            "role": "client", "businessName": name,
        })
        assert r.status_code == 201, r.text
        r = api.post("/api/auth/verify-otp", json={"email": email, "otp": issued_otps[-1]})
        assert r.status_code == 200, r.text
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        client_id = api.get("/api/clients/me", headers=headers).json()["client"]["id"]
        return SimpleNamespace(headers=headers, client_id=client_id, gstin=gstin)

    return create
