# MailMind — AI Email Agent

Next.js app with Google sign-in, animated landing page, and dashboard. LangGraph agent coming next.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `AUTH_SECRET` | Session signing (`openssl rand -base64 32`) |
| `AUTH_URL` | `http://localhost:3000` |
| `OPENROUTER_API_KEY` | For LangGraph agent (later) |

## Google Cloud setup

1. OAuth redirect URI: `http://localhost:3000/api/auth/callback/google`
2. Add your email as a **test user** on the consent screen

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page + Google sign-in |
| `/dashboard` | Protected dashboard (requires login) |
