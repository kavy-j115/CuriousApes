# Setup

## Prerequisites (checked at Milestone 0)

| Tool | Status | Notes |
|---|---|---|
| Python 3.13 | installed | |
| Git | installed | |
| PostgreSQL | via Supabase (cloud) | see below |
| Docker | not installed | not needed while using Supabase |

## 1. Python virtual environment

A virtual environment keeps this project's Python packages separate from
anything else on your machine, so `pip install`s here can't break (or be
broken by) another project.

```bash
python -m venv venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
```

## 2. Database (Supabase)

We're using [Supabase](https://supabase.com) for Postgres during development —
free hosted Postgres, no local install. Create a project there, then:

1. Go to Project Settings -> Database -> Connection string -> URI.
2. Copy `.env.example` to `.env`.
3. Paste the connection string into `DATABASE_URL` in `.env`, filling in your
   real password.

`.env` is git-ignored — it never gets committed, so this is safe to fill in
with real credentials.

## 3. Verify

(Added once `src/database/` has a connection-check script — Milestone 2.)
