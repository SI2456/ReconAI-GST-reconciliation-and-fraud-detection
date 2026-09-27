from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# server/.env resolved absolutely from this file, so it loads no matter which
# directory the server is started from (root, server/, or an IDE working dir).
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

# Secrets that ship in this repo; fine for local dev, never for production.
_PUBLIC_JWT_SECRETS = {
    "change-this-secret-before-production",
    "reconai-development-super-secret-key-change-in-production",
}


class Settings(BaseSettings):
    app_name: str = "ReconAI API"
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 4000
    client_origin: str = "http://localhost:5173"

    database_url: str = "postgresql+psycopg://reconai:reconai@localhost:5432/reconai"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str = "change-this-secret-before-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 720

    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "reconai-documents"

    email_host: str = ""
    email_port: int = 587
    email_host_user: str = ""
    email_host_password: str = ""
    email_use_tls: bool = True
    default_from_email: str = "no-reply@reconai.local"

    gstverify_api_key: str = ""
    gstverify_base_url: str = "https://api.gstverify.dubey.app/api/v1"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5vl:3b"

    model_config = SettingsConfigDict(env_file=str(ENV_FILE), env_file_encoding="utf-8", extra="ignore")

    @model_validator(mode="after")
    def _require_real_jwt_secret_in_production(self) -> "Settings":
        if self.environment.strip().lower() in {"production", "prod"}:
            if self.jwt_secret_key in _PUBLIC_JWT_SECRETS or len(self.jwt_secret_key) < 32:
                raise ValueError(
                    "JWT_SECRET_KEY must be a private value of at least 32 characters in production. "
                    'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
                )
        return self


settings = Settings()
