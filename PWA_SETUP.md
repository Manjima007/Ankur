# ANKUR PWA & Push Notifications Setup Guide

## Overview

This document describes the complete Push Notification infrastructure added to ANKUR for high-urgency emergency blood donation alerts. The system enables system-level notifications even when the browser is closed.

---

## 1. Architecture

### Frontend Components
- **manifest.json** - PWA metadata, theme, icons, shortcuts
- **public/sw.js** - Service Worker handling push events & caching
- **app/NotificationManager.tsx** - UI component for permission & subscription
- **layout.tsx** - Manifest link + NotificationManager integration

### Backend Components
- **push_subscriptions table** - Stores user subscription endpoints & keys
- **POST /api/notifications/subscribe** - Register subscription
- **POST /api/notifications/unsubscribe** - Deregister subscription
- **dispatch_push_notifications()** - Background task dispatching to 10km radius users

### Data Flow
```
User → [Enable Button] → Notification.requestPermission() 
  → pushManager.subscribe(VAPID_KEY) 
  → POST /api/notifications/subscribe 
  → Backend stores in push_subscriptions

Blood Request Created 
  → Query matching users within 10km + matching blood type 
  → Get their subscriptions from push_subscriptions table 
  → Use pywebpush to send encrypted notification 
  → System-level alert appears on user's device (even if browser closed)
```

---

## 2. Environment Variables

Add these to your `.env` files:

### Backend (.env in Ankur_backend/)
```bash
# VAPID Keys for Push Notifications
# Generate using: python -c "from pywebpush import generate_vapid_keys; keys = generate_vapid_keys(); print('Private:', keys['private_key']); print('Public:', keys['public_key'])"
VAPID_PRIVATE_KEY=your_private_key_here
VAPID_PUBLIC_KEY=your_public_key_here
VAPID_EMAIL=admin@ankur.health
```

### Frontend (.env.local in ankur-frontend/)
```bash
# VAPID Public Key (safe to expose - used for subscription only)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_public_key_here
```

---

## 3. VAPID Keys Generation

Run this command to generate fresh VAPID keys:

```bash
cd d:\Ankur\Ankur_backend
python -c "from pywebpush import generate_vapid_keys; keys = generate_vapid_keys(); print(f'Private: {keys[\"private_key\"]}'); print(f'Public: {keys[\"public_key\"]}')"
```

**Important**: Store the private key securely - it's used to sign push notifications. If compromised, regenerate both keys.

---

## 4. Installation & Dependencies

### Backend
```bash
cd d:\Ankur\Ankur_backend
pip install -r requirements.txt
# Installs: fastapi, uvicorn, sqlalchemy, psycopg2-binary, python-jose, pywebpush, twilio
```

### Frontend
```bash
cd d:\Ankur\ankur-frontend
npm install
```

---

## 5. Database Schema

The `push_subscriptions` table is auto-created by `initialize_schema()`:

```sql
CREATE TABLE push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);
```

---

## 6. API Endpoints

### Subscribe to Push Notifications
**POST** `/api/notifications/subscribe`

Request:
```json
{
  "subscription": {
    "endpoint": "https://fcm.googleapis.com/fcm/send/...",
    "keys": {
      "p256dh": "base64_encoded_key",
      "auth": "base64_encoded_auth"
    }
  },
  "user_id": "uuid_string"
}
```

Response:
```json
{
  "status": "subscribed",
  "message": "Push notifications enabled"
}
```

### Unsubscribe from Push Notifications
**POST** `/api/notifications/unsubscribe`

Request:
```json
{
  "user_id": "uuid_string",
  "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

Response:
```json
{
  "status": "unsubscribed",
  "message": "Push notifications disabled"
}
```

---

## 7. Blood Emergency Dispatch Flow

When `/api/request-blood` is called:

1. **Create Emergency** - Insert blood request into `emergencies` table
2. **Query Matching Users** - Find users where:
   - Blood type matches
   - `is_active = TRUE`
   - Within 10km radius (using PostGIS distance formula)
   - Have active push subscriptions
3. **Dispatch Notifications** - For each matching user:
   - Get their subscription from `push_subscriptions`
   - Encrypt notification with VAPID private key
   - Send via pywebpush
   - Remove failed/expired subscriptions (410 Gone)

### Notification Payload
```json
{
  "title": "CRITICAL: O- Required",
  "body": "A patient at City Hospital needs your help. Tap to see details.",
  "icon": "/ankur_logo.png",
  "badge": "/ankur_logo.png",
  "tag": "ankur-emergency-123",
  "vibrate": [200, 100, 200],
  "data": {
    "emergencyId": "e123",
    "url": "/dashboard?emergency=e123"
  }
}
```

---

## 8. Service Worker (public/sw.js)

The Service Worker:
- **Caches** static assets for offline access
- **Listens to push events** and displays notifications
- **Handles notification clicks** to navigate to emergency details
- **Network-first strategy** for dynamic content

Key events:
- `install` - Cache essential assets
- `activate` - Clean old caches
- `fetch` - Network-first, fallback to cache
- `push` - Show notification with payload
- `notificationclick` - Open emergency details page

---

## 9. Frontend Components

### NotificationManager.tsx
Located at `app/NotificationManager.tsx`

Features:
- Permission request with user-friendly error handling
- Toggle button showing alert status (🔔 Alerts Active / Enable Alerts)
- Background/foreground subscription management
- Graceful degradation for unsupported browsers
- Error display for permission denied
- Auto-initialization on page load

Usage (already integrated in layout.tsx):
```tsx
import NotificationManager from "./NotificationManager";

export default function RootLayout() {
  return (
    <html>
      <body>
        <NotificationManager />
        {children}
      </body>
    </html>
  );
}
```

### Manifest.json
Located at `public/manifest.json`

Key fields:
- `theme_color`: `#9D1720` (Deep Crimson)
- `background_color`: `#FAF7F2` (Parchment)
- `start_url`: `/dashboard`
- `display`: `standalone` (hides browser UI)
- `icons`: 192x192, 512x512, maskable formats
- `shortcuts`: Quick actions (Create Request, View Emergencies)
- `categories`: `["medical", "health"]`

---

## 10. Testing

### Local Testing

#### Test Subscription Flow
1. Open dashboard in Chrome/Edge
2. Click "🔔 Enable Alerts" button
3. Approve notification permission popup
4. Check browser DevTools → Application → Service Workers (should be registered)
5. Check Application → Manifest (should show loaded config)
6. Open DevTools → Console, check for "Subscription saved to backend successfully"

#### Test Push Notification (Requires Backend Running)
```bash
# Via curl (from backend machine):
curl -X POST http://localhost:8000/api/request-blood \
  -F "hospital_name=Test Hospital" \
  -F "patient_age=30" \
  -F "contact_email=test@hospital.com" \
  -F "blood_type_needed=O-" \
  -F "urgency=CRITICAL" \
  -F "latitude=40.7128" \
  -F "longitude=-74.0060" \
  -H "Authorization: Bearer <token>" \
  --form-string "recipient_latitude=40.7128" \
  --form-string "recipient_longitude=-74.0060"

# Should trigger push notifications to subscribed users within 10km
```

#### Verify Service Worker Cache
1. DevTools → Application → Cache Storage
2. Should see `ankur-v1` with cached assets
3. Go offline (DevTools → Offline)
4. Dashboard should still load from cache

---

## 11. Production Deployment Checklist

- [ ] Generate VAPID keys (DO NOT commit to git)
- [ ] Set `VAPID_PRIVATE_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in deployment environment
- [ ] Ensure `VAPID_EMAIL` is valid contact email
- [ ] Test push notifications on Android device (iOS support limited)
- [ ] Enable HTTPS in production (required for Service Workers)
- [ ] Set up monitoring for push delivery failures
- [ ] Implement subscription refresh logic (subscriptions expire ~12 months)
- [ ] Add analytics for push engagement rates
- [ ] Test offline mode and cache expiration
- [ ] Set up error logging for `dispatch_push_notifications` failures

---

## 12. Troubleshooting

### Service Worker Not Registering
- Check browser DevTools → Application → Service Workers
- Verify `manifest.json` is accessible at `/manifest.json`
- Ensure HTTPS (or localhost)
- Check browser console for registration errors

### Push Notifications Not Received
- Verify user has enabled notifications (check permission in DevTools Settings)
- Confirm subscription endpoint in database: `SELECT * FROM push_subscriptions;`
- Check backend logs for `dispatch_push_notifications` execution
- Verify VAPID keys match in backend & frontend
- Test with explicitly calling subscription endpoint

### Subscription Endpoint Removed
- If users have `push_subscriptions` but don't receive notifications
- Browser may have invalidated subscription (expires ~12 months)
- User can re-enable in UI → will create new subscription
- Implement background sync to refresh subscriptions

### Backend Error: "VAPID keys not configured"
- Generate keys using the command in **Section 3**
- Add `VAPID_PRIVATE_KEY` to `.env` file
- Restart backend server
- Check logs for "DEBUG: Push notification simulation..." (indicates keys not set)

---

## 13. Performance Optimizations

### Current Implementation
- Push dispatch runs in background task (non-blocking)
- Database queries use PostGIS spatial index for 10km radius filter
- Failed subscriptions automatically removed (410 Gone status)
- Push notifications are throttled per emergency (dedup via tag)

### Future Enhancements
- Implement Redis queue for massive scale (>100k users)
- Add subscription refresh background task (monthly)
- Implement push delivery analytics
- Add A/B testing for notification titles/content
- Batch dispatch for multiple blood types

---

## 14. File Structure

```
ankur-frontend/
├── public/
│   ├── manifest.json           ← PWA metadata
│   └── sw.js                   ← Service Worker
├── app/
│   ├── layout.tsx              ← Manifest link + NotificationManager
│   ├── NotificationManager.tsx ← Subscription UI component
│   └── globals.css
└── package.json

Ankur_backend/
├── main.py                     ← Updated with push endpoints & dispatch
├── requirements.txt            ← Added pywebpush
└── .env                        ← Add VAPID keys here
```

---

## 15. References

- [Web Push Protocol RFC 8030](https://tools.ietf.org/html/rfc8030)
- [pywebpush Documentation](https://github.com/mozilla-services/PyWebPush)
- [MDN Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [PostGIS Distance Function](https://postgis.net/docs/ST_Distance_Sphere.html)

---

## 16. Support

For issues or questions:
1. Check troubleshooting section above
2. Review backend logs: `dispatch_push_notifications()` output
3. Verify subscription in database: `SELECT COUNT(*) FROM push_subscriptions;`
4. Test Service Worker registration in DevTools
5. Verify VAPID keys in both backend and frontend environment variables
