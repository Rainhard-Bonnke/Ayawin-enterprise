# Ayawin Enterprise ERP

## What runs where

- Frontend: Vite app at `http://localhost:5173`
- Backend: Express API at `http://localhost:4000`
- Database: PostgreSQL

## Option 1: Easiest local dev with a local PostgreSQL instance

Use this if you already have PostgreSQL running on your machine.

1. Copy env files:

```bash
Copy-Item backend\.env.example backend\.env
Copy-Item .env.example .env
```

2. Start both apps:

```bash
npm install
cd backend
npm install
cd ..
npm run dev:all
```

3. Open:
- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/health`

## Option 2: Docker for database and backend, frontend locally

Use this if you do not want to install PostgreSQL locally.

1. Start the database and backend:

```bash
docker-compose up --build
```

2. In a second terminal, point the frontend at the backend API:

```bash
$env:VITE_API_BASE="http://localhost:4000"
npm run dev
```

3. Open the frontend at `http://localhost:5173`

## Backend env

`backend/.env.example` is set up for local development:

- `DATABASE_HOST=localhost`
- `PORT=4000`

If you run the backend inside Docker, use `DATABASE_HOST=db`.

## Login

Default seed login:

- Email: `admin@martin.co.ke`
- Password: `demo`
