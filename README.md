# MailMind — AI Email Agent

Next.js app with **Supabase Auth** (email + Google), dashboard, and CI/CD.

## Auth flow

1. **Sign up / sign in** — email + password or Google at `/login`
2. **Connect Gmail** — separate step on dashboard (Gmail API scopes)
3. **Agent** — LangGraph main graph (persona + email + feedback) via OpenRouter
4. **SQL** — run `002_chat_threads.sql`, `003_persona_feedback.sql`, then `004_agent_memory_profile.sql` (reshapes `agent_memory` to one JSON doc per user)

## Setup

```bash
npm install
npm run dev
```

### Environment variables

Copy `.env.example` to `.env` and fill in Supabase + OpenRouter keys.

### Supabase dashboard

1. **Authentication → Providers** — enable Email + Google
2. **Authentication → URL Configuration** — add redirect URLs:
   - `http://localhost:3000/**`
   - `https://your-vercel-domain.vercel.app/**`
3. **Authentication → Providers → Google** — add Google Client ID/Secret
4. **Authentication → General** — enable **Manual linking** (for Connect Gmail)

### Google Cloud

Redirect URI for Supabase:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

## Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/login` | Email + Google sign-in |
| `/dashboard` | Protected workspace |
| `/auth/callback` | Supabase OAuth callback |
