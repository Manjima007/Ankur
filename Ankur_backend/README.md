# ANKUR Backend

FastAPI backend for ANKUR (Blood Emergency Network), including JWT auth and 5km PostGIS donor matching.

## Environment

Create `.env` from `.env.example` and fill values:

```env
SUPABASE_POOLER_URI=
SUPABASE_URI=
SECRET_KEY=
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
DATA_GOV_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

Prefer `SUPABASE_POOLER_URI` (Supabase Transaction Pooler, port `6543`) when your network is IPv4-only.

## Install

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload
```

## Deploy (Render)

Recommended free deployment uses Render Web Service.

1. Push repository to GitHub.
2. Use `render.yaml` from workspace root (`../render.yaml`) via Render Blueprint deploy.
3. Set required environment variables:
	- `SUPABASE_URI`
	- `SECRET_KEY`
	- `CORS_ORIGINS`
	- `VAPID_PRIVATE_KEY`
	- `VAPID_PUBLIC_KEY`
4. Start command is:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

For full frontend+backend steps, see `../DEPLOYMENT_GUIDE.md`.

## Seed Blood Banks

```bash
python seed_data.py
```

Seed script now skips already existing records based on `(name, address, phone)`.

## Donation Eligibility Rule

- 5km proximity matching is removed.
- Donors are now considered eligible based on donation history:
	- If last donation is more than 90 days ago (or never donated), donor can accept a request.
	- If donor tries to accept before 90 days, account is automatically deactivated.

## New API

- POST /api/accept-request
	- Body: { "emergency_id": number }
	- Requires Bearer token.
	- On success: marks emergency accepted and updates donor last_donation_date.
	- On invalid eligibility (< 90 days): deactivates donor account and returns 403.
