# ⚙️ ReconAI Backend Service

FastAPI backend powering the ReconAI GST reconciliation platform, authentication, OCR document extraction, and fraud analytics.

---

## 🛠️ Quick Backend Setup

### 1. Create and Activate Virtual Environment
```bash
cd server
python -m venv .venv

# On Windows:
.venv\Scripts\activate

# On macOS/Linux:
source .venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```

Set your database connection URL in `.env`:
* **Docker Compose (Default)**: `DATABASE_URL=postgresql+psycopg://reconai:reconai@localhost:5432/reconai`
* **Local PostgreSQL**: `DATABASE_URL=postgresql+psycopg://<username>:<password>@localhost:5432/reconai`
* **SQLite Mode**: `DATABASE_URL=sqlite:///./server/data/reconai-dev.sqlite3`

---

## 🗄️ Database Management & Seeding

```bash
# Check database connectivity:
python scripts/check_db.py

# Run schema migrations:
python scripts/migrate.py

# Seed demo clients, invoices, supplier master, and fraud alerts:
python scripts/seed.py
```

---

## 🚀 Running the API Server

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 4000 --reload
```
* **API Root**: `http://localhost:4000`
* **Swagger Interactive Docs**: `http://localhost:4000/docs`
* **Redoc Documentation**: `http://localhost:4000/redoc`

---

## 🔑 Pre-Configured Demo Logins

* **Admin**: `admin.demo@reconai.local` / `Demo@123`
* **CA**: `ca.demo@reconai.local` / `Demo@123`
* **Client**: `client.demo@reconai.local` / `Demo@123`

---

## 📁 Key Directories & Modules

* `app/core/` — App configuration (`config.py`), security (`security.py`), database engine (`database.py`)
* `app/models/` — SQLAlchemy ORM schemas (`user.py`, `client.py`, `invoice.py`, `fraud_alert.py`, etc.)
* `app/api/` — FastAPI REST endpoints (auth, clients, reconciliation, fraud, ingestion, admin)
* `app/services/` — Business logic (reconciliation engine, OCR processor, fraud detection models)
* `scripts/` — Database migrations (`migrate.py`), seeding script (`seed.py`), DB diagnostics (`check_db.py`)
