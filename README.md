# Dress Shopping Purchase Application

Full-stack dress shopping app based on `AGENTPURCHASE.md`.

## Stack

- Frontend: React + Vite + React Router + Axios + Bootstrap
- Backend: Node.js + Express + MySQL + JWT + bcrypt + Nodemailer
- Database: MySQL

## Quick Start

1. Create MySQL database credentials or use the defaults in `backend/.env.example`.
2. Install dependencies:

```bash
cd backend
npm install
npm run db:setup
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

## Default Admin

- User ID: `admin`
- Password: `adm@123`

## Notes

- Backend runs on `http://localhost:5000` by default.
- Frontend runs on `http://localhost:5173` by default.
- Forgot password is implemented with Nodemailer. In development, configure SMTP in `backend/.env` or check backend logs if no SMTP user is configured.
