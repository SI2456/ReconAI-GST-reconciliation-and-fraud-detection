"""Sign-up can be resumed if the OTP screen was closed before verifying."""
import uuid


def _register(api, email: str, password: str, name: str = "Resume Test"):
    return api.post("/api/auth/register", json={
        "name": name, "email": email, "password": password,
        "role": "client", "businessName": f"{name} Co",
    })


def test_unverified_email_can_register_again_and_verify(api, issued_otps):
    email = f"resume-{uuid.uuid4().hex[:6]}@example.com"
    assert _register(api, email, "first-password").status_code == 201
    first_otp = issued_otps[-1]
    # ...the OTP screen is closed here, without verifying...

    r = _register(api, email, "second-password")
    assert r.status_code == 201, r.text
    assert "backend terminal" in r.json()["message"]  # email isn't configured in tests
    assert issued_otps[-1] != first_otp or len(issued_otps) >= 2

    r = api.post("/api/auth/verify-otp", json={"email": email, "otp": issued_otps[-1]})
    assert r.status_code == 200, r.text
    assert api.post("/api/auth/login", json={"email": email, "password": "second-password"}).status_code == 200
    assert api.post("/api/auth/login", json={"email": email, "password": "first-password"}).status_code == 401


def test_unverified_login_then_resend_then_verify(api, issued_otps):
    email = f"login-{uuid.uuid4().hex[:6]}@example.com"
    assert _register(api, email, "my-password").status_code == 201

    r = api.post("/api/auth/login", json={"email": email, "password": "my-password"})
    assert r.status_code == 403 and "verify your email" in r.json()["detail"].lower()

    r = api.post("/api/auth/resend-otp", json={"email": email, "purpose": "registration"})
    assert r.status_code == 200 and "backend terminal" in r.json()["message"]
    r = api.post("/api/auth/verify-otp", json={"email": email, "otp": issued_otps[-1]})
    assert r.status_code == 200, r.text
    assert api.post("/api/auth/login", json={"email": email, "password": "my-password"}).status_code == 200


def test_wrong_password_on_unverified_account_is_401(api):
    email = f"wrongpw-{uuid.uuid4().hex[:6]}@example.com"
    assert _register(api, email, "right-password").status_code == 201
    r = api.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
    assert r.status_code == 401  # "not verified" is only revealed with the right password


def test_verified_email_cannot_register_again(api, new_client_workspace):
    ws = new_client_workspace("AlreadyVerified")
    email = api.get("/api/me", headers=ws.headers).json()["user"]["email"]
    r = _register(api, email, "another-password")
    assert r.status_code == 409
