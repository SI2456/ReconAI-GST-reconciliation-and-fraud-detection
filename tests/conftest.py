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
)
# Local storage writes to ./server/data/uploads relative to the working directory.
os.chdir(_TMP)
sys.path.insert(0, str(ROOT / "server"))

atexit.register(shutil.rmtree, _TMP, ignore_errors=True)
