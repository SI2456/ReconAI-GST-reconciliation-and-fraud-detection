# 🚀 ReconAI — AI-Powered GST Reconciliation & ITC Fraud Detection

ReconAI is an enterprise-grade GST reconciliation platform for Chartered Accountants (CAs), enterprises, and MSMEs. It reconciles Books of Accounts (Purchase Registers) against GST Portal filings (GSTR-2B / GSTR-1), detects missing ITC claims, flags duplicate invoices, matches Purchase Orders (3-way PO match), and uncovers circular trading & tax evasion anomalies using machine learning.

---

## 📋 System Architecture

* **Frontend**: React 18, Vite, TailwindCSS, Radix UI, Recharts, Lucide Icons (`http://localhost:5173`)
* **Backend API**: FastAPI (Python 3.10+), SQLAlchemy 2.0, Uvicorn, Pydantic v2 (`http://localhost:4000`)
* **Primary Database**: PostgreSQL 16 (`reconai` database)
* **Offline Fallback Database**: SQLite 3 (`server/data/reconai-dev.sqlite3`)
* **Background & Cache**: Redis (optional), Python async workers
* **ML / OCR**: Tesseract / Ollama Vision (Qwen2.5-VL), Isolation Forest, Scikit-learn, RapidFuzz

---

## 📁 Project Folder Structure

```
ReconAI/
├── src/                    # React frontend (Vite, Tailwind, UI components, pages)
├── server/                 # FastAPI backend, API routes, models, migration & seed scripts
├── reference_data/         # Statutory reference tables (HSN.xlsx, SAC.xlsx) & extraction logic
├── sample_data/            # Sample test invoices (PDFs, JPGs) & Master Answer Key
├── reconai_dummy_data/     # Comprehensive multi-client test dataset folders
├── docs/                   # Documentation & media assets (logos, demo videos)
│   └── media/
├── tests/                  # Standalone testing, verification, and evaluation scripts
├── index.html              # Frontend entry point
├── package.json            # Node.js dependencies & workflow scripts
└── README.md               # Setup and development guide
```

## 🛠️ Prerequisites

Before setting up the project on your PC, ensure you have installed:

1. **[Node.js](https://nodejs.org/)** (v18.x or higher) & **npm**
2. **[Python](https://www.python.org/downloads/)** (v3.10, v3.11, or v3.12 recommended)
3. **Database** (Choose one of the following):
   - **Option A (Recommended)**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (to run PostgreSQL with 1 command)
   - **Option B**: [PostgreSQL](https://www.postgresql.org/download/) installed locally on your PC
   - **Option C**: Pure SQLite (no database installation needed)

---

## ⚡ Quick Setup Guide (Step-by-Step)

### Step 1: Open the Project Directory
Open your terminal (PowerShell, Command Prompt, or Bash) in the project root:
```bash
cd ReconAI
```

---

### Step 2: Install Frontend Dependencies
```bash
npm install
```

---

### Step 3: Set Up Python Backend Virtual Environment

```bash
# 1. Navigate to the server folder
cd server

# 2. Create a virtual environment named .venv
python -m venv .venv

# 3. Activate the virtual environment:
# On Windows PowerShell:
.venv\Scripts\Activate.ps1
# (Or on Windows Command Prompt: .venv\Scripts\activate.bat)
# (Or on macOS/Linux: source .venv/bin/activate)

# 4. Install all required Python packages:
pip install -r requirements.txt
```

---

### Step 4: Configure Environment Variables (`server/.env`)

1. Copy the example configuration file:
   ```bash
   # Inside server/ directory:
   copy .env.example .env
   # (Or on Linux/macOS: cp .env.example .env)
   ```

2. Open `server/.env` and configure your database:

   * **If using Docker Compose:**
     ```env
     DATABASE_URL=postgresql+psycopg://reconai:reconai@localhost:5432/reconai
     ```

   * **If using your local PostgreSQL installation:**
     ```env
     DATABASE_URL=postgresql+psycopg://<your_postgres_user>:<your_postgres_password>@localhost:5432/reconai
     PGHOST=localhost
     PGPORT=5432
     PGUSER=<your_postgres_user>
     PGPASSWORD=<your_postgres_password>
     PGDATABASE=reconai
     ```
     > ⚠️ **Important:** If your PostgreSQL password contains special symbols (such as `@`, `#`, `$`, `%`), encode them in the URL (e.g. `@` $\rightarrow$ `%40`, `#` $\rightarrow$ `%23`).

   * **If using SQLite (No Postgres installed):**
     ```env
     DATABASE_URL=sqlite:///./server/data/reconai-dev.sqlite3
     ```

---

### Step 5: Run Database & Seed Demo Data

Choose your preferred database method:

#### Option A: Using Docker (Fastest)
From the project root:
```bash
# Start PostgreSQL & Redis in the background
npm run db:up

# Run migrations and seed demo data
npm run db:migrate
npm run backend:seed
```

#### Option B: Using Local PostgreSQL
1. Create the database in PostgreSQL (e.g., in pgAdmin or `psql`):
   ```sql
   CREATE DATABASE reconai;
   ```
2. Initialize tables and seed demo records:
   ```bash
   npm run db:migrate
   npm run backend:seed
   ```

#### Option C: Using SQLite
```bash
npm run backend:seed
```

---

### Step 6: Start the Application

You can start both Backend and Frontend together with one command:

```bash
npm run dev:full
```

Or start them individually in two separate terminals:

* **Terminal 1 (Backend API)**:
  ```bash
  npm run backend
  ```
  *API runs at: `http://localhost:4000` (Docs: `http://localhost:4000/docs`)*

* **Terminal 2 (Frontend UI)**:
  ```bash
  npm run dev
  ```
  *Web App runs at: `http://localhost:5173`*

---

## 🔑 Demo Login Accounts

After seeding the database, you can log in with any of these pre-configured accounts:

| Role | Email | Password | Access / Permissions |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin.demo@reconai.local` | `Demo@123` | Full administrative control, system logs, user management |
| **Chartered Accountant (CA)** | `ca.demo@reconai.local` | `Demo@123` | Client portfolios, reconciliation engine, OCR ingestion, fraud audit |
| **Client / Business Owner** | `client.demo@reconai.local` | `Demo@123` | Client portal, invoice upload, compliance score, GSTIN verification |

---

## 📁 Key Project Scripts & Commands

All standard workflows can be run using `npm` from the project root:

| Command | Description |
| :--- | :--- |
| `npm run dev:full` | Starts both Frontend (`5173`) and Backend API (`4000`) concurrently |
| `npm run dev` | Starts only the Vite Frontend dev server |
| `npm run backend` | Starts the FastAPI backend with hot-reload |
| `npm run db:up` | Starts PostgreSQL & Redis containers via Docker |
| `npm run db:down` | Stops the Docker database containers |
| `npm run db:migrate` | Runs database schema migrations |
| `npm run db:check` | Tests connectivity to the configured database |
| `npm run backend:seed` | Seeds demo clients, invoices, supplier master, and reconciliation runs |
| `npm run build` | Builds the production frontend bundle in `dist/` |
| `npm test` | Runs the reconciliation tests against the mock datasets' answer keys |

---

## 🧪 Running Tests

`tests/test_answer_key.py` uploads each mock company in `reconai_dummy_data/` through the API, runs reconciliation, and checks every invoice's status against that company's `answer_key.csv`. It also checks that the document details view shows the GSTR-2B record reconciliation actually paired. It uses a throwaway SQLite database, so your `server/.env` database and `server/data/` are never touched.

```bash
# One-time: install pytest into the backend virtual environment
server\.venv\Scripts\python.exe -m pip install -r server/requirements-dev.txt

# Run the tests (from the project root)
npm test
```

A new mock company is picked up automatically: add a folder with `answer_key.csv`, `purchase_register.csv` and `gstr2b_MM_YYYY.json` files.

---

## 🔍 Troubleshooting & FAQs

### 1. Database Connection Error (`connection refused` or `password authentication failed`)
* Ensure PostgreSQL service is running (or `docker compose up -d`).
* Verify credentials in `server/.env`.
* If your password contains `@`, replace it with `%40` in `DATABASE_URL` (e.g. `MyP@ssword` becomes `MyP%40ssword`).

### 2. PowerShell Script Execution Error (`Activate.ps1 cannot be loaded`)
If Windows blocks activating the virtual environment, run this once in PowerShell:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 3. Port Already in Use (4000 or 5173)
* If port `4000` is in use, you can kill existing Python processes:
  * PowerShell: `Stop-Process -Name python -Force`
* If port `5173` is busy, Vite will automatically prompt or select `5174`.

### 4. Optional External Services
* **Email Verification (OTP)**: If `EMAIL_HOST` is left blank, OTPs are printed directly in the backend terminal console for instant testing.
* **OCR / Vision Model**: Basic text extraction from digital PDFs runs automatically via `pypdf`. For scanned PDF image OCR, install [Ollama](https://ollama.com) and run `ollama pull qwen2.5vl:3b`.
