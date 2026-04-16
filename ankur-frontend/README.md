# ANKUR Frontend

Next.js App Router frontend for the ANKUR blood emergency network.

## Environment

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Default value:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

## Development

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.

## Deploy (Vercel)

1. Push repository to GitHub.
2. Import project in Vercel.
3. Set root directory to `ankur-frontend`.
4. Add environment variables:

```env
NEXT_PUBLIC_API_URL=https://your-backend-url.onrender.com
NEXT_PUBLIC_API_BASE_URL=https://your-backend-url.onrender.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_vapid_key
```

5. Deploy and copy your Vercel URL.

For full stack deployment steps, see `../DEPLOYMENT_GUIDE.md`.

## Implemented So Far (Verified)

As of April 12, 2026, the following features are implemented and wired end-to-end with the backend APIs.

### Authentication

- Login and donor registration UI are implemented on the landing page.
- Login uses FastAPI OAuth2 form-style request (`POST /login`).
- Registration sends donor details including geolocation (`POST /register`).
- JWT token is saved in browser local storage as `ankur_token`.
- API client automatically attaches Bearer token in request interceptor.

### Geolocation and Donor Capture

- Registration flow requests browser GPS location on page load.
- Registration is blocked until coordinates are available.
- Geo-status banner is shown for success/denied/pending states.

### Dashboard

- Protected dashboard route with token check and redirect to login when missing/invalid.
- Profile loading from `GET /api/me`.
- Emergency feed from `GET /api/emergencies`.
- Blood bank list with search from `GET /api/blood-banks`.
- Local profile cache with short TTL for smoother reload behavior.
- Loading skeleton, retry flow, and cooldown-based retry button.
- Notification center for success/warning/info events.
- Activity timeline generated from user requests and accepted events.

### Emergency Actions

- Create blood request modal and submit flow (`POST /api/request-blood`).
- Emergency request acceptance flow (`POST /api/accept-request`).
- UI-level accept-state handling using backend-provided `can_accept` and `accept_block_reason`.

### Donor Safety and Eligibility

- 90-day donation eligibility status is displayed in dashboard.
- Eligibility progress and next-eligible-day indicators are shown.
- UI messaging reflects deactivation and eligibility restrictions from backend responses.

### API Reliability Features

- Central Axios client with timeout and request/response interceptors.
- API health tracking via consecutive failure monitoring.
- Degraded mode signaling after repeated failures.

## Backend Support Confirmed

The frontend flows above are backed by implemented endpoints in the current backend:

- `POST /register`
- `POST /login`
- `GET /api/me`
- `GET /api/emergencies`
- `GET /api/blood-banks`
- `POST /api/request-blood`
- `POST /api/accept-request`

## Notes

- Registration requires browser location access to prevent invalid donor coordinates.
- Backend enforces 90-day donation rule during request acceptance.
