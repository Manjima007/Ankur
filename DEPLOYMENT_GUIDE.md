# ANKUR Deployment Guide (Free Hosting)

This setup deploys:
- Frontend: Vercel (free)
- Backend: Render Web Service (free)
- Database: Supabase (free)

## 1. Prerequisites

- GitHub repository with this code pushed.
- Supabase Postgres URI.
- VAPID keys for web push.

Generate VAPID keys (once):

```bash
cd Ankur_backend
python -c "from pywebpush import generate_vapid_keys; keys = generate_vapid_keys(); print('Private:', keys['private_key']); print('Public:', keys['public_key'])"
```

## 2. Deploy Backend on Render

Use the existing `render.yaml` in workspace root.

### Option A: Blueprint deploy
1. In Render, create a new Blueprint from your GitHub repo.
2. Render reads `render.yaml` automatically.
3. Set these secret env vars in Render dashboard:
   - `SUPABASE_URI`
   - `SECRET_KEY`
   - `CORS_ORIGINS` (set this after frontend URL is known)
   - `VAPID_PRIVATE_KEY`
   - `VAPID_PUBLIC_KEY`
   - `TWILIO_ACCOUNT_SID` (optional)
   - `TWILIO_AUTH_TOKEN` (optional)
   - `TWILIO_PHONE_NUMBER` (optional)
4. Deploy and copy backend URL, e.g. `https://ankur-backend.onrender.com`.

### Backend health check
Open:
- `https://your-backend-url/docs`

## 3. Deploy Frontend on Vercel

1. Import repo into Vercel.
2. Set project root to `ankur-frontend`.
3. Add env vars:
   - `NEXT_PUBLIC_API_BASE_URL=https://your-backend-url.onrender.com`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your_public_vapid_key>`
4. Deploy.
5. Copy Vercel URL, e.g. `https://ankur-frontend.vercel.app`.

## 4. Final CORS setup

Set backend env var `CORS_ORIGINS` to:

```text
https://ankur-frontend.vercel.app,http://localhost:3000,http://127.0.0.1:3000
```

Then redeploy backend.

`CORS_ORIGIN_REGEX` already allows Vercel preview URLs by default.

## 5. PWA and Push checklist

- `manifest.json` loads from frontend URL.
- `sw.js` loads from frontend URL.
- Frontend env has `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- Backend env has both `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY`.
- Browser is HTTPS and not incognito for install prompt.

## 6. Important free-tier notes

- Render free instances can sleep after inactivity.
- First API request after sleep may be slow.
- Local upload path (`Ankur_backend/uploads`) is ephemeral in free containers.
  - Use cloud storage for long-term requisition file persistence in production.

## 7. Quick smoke test after deploy

1. Open frontend URL.
2. Switch language and verify UI text changes.
3. Register/login works.
4. Dashboard loads.
5. Create a blood request.
6. Install button appears in supported browser.
7. Notifications subscription works.

## 8. CI/CD Auto-Deploy (GitHub Actions)

Workflow file:
- `.github/workflows/deploy.yml`

What it does on push to `main`/`master`:
1. Detects changed paths for backend/frontend.
2. Runs quality checks (Python compile, Next.js production build).
3. Triggers deploy hooks only for changed parts.

Required GitHub repository secrets:
- `RENDER_DEPLOY_HOOK_URL`
- `VERCEL_DEPLOY_HOOK_URL`

How to get deploy hooks:
1. Render: Service Settings -> Deploy Hook -> copy URL.
2. Vercel: Project Settings -> Git -> Deploy Hooks -> create hook and copy URL.
