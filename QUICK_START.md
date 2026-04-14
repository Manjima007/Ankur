# ANKUR PWA Implementation - Quick Start Checklist

## ✅ Completed Components

### Frontend Files
- ✅ **public/manifest.json** - PWA metadata with Deep Crimson theme
- ✅ **public/sw.js** - Service Worker with push/cache handlers
- ✅ **app/NotificationManager.tsx** - Subscription UI component (🔔 button)
- ✅ **app/layout.tsx** - Updated with manifest link & NotificationManager import

### Backend Files
- ✅ **main.py** - Added push_subscriptions table, subscription endpoints, dispatch logic
- ✅ **requirements.txt** - Added pywebpush dependency

---

## 🚀 Immediate Next Steps

### 1. Generate VAPID Keys
**Time: 2 minutes**

```bash
cd d:\Ankur\Ankur_backend
python -c "from pywebpush import generate_vapid_keys; keys = generate_vapid_keys(); print(f'Private:\n{keys[\"private_key\"]}\n\nPublic:\n{keys[\"public_key\"]}')"
```

Copy both keys securely.

### 2. Add Environment Variables

**Backend: Create/update d:\Ankur\Ankur_backend\.env**
```bash
SUPABASE_URI=your_existing_uri
SECRET_KEY=your_existing_key

# NEW - Add these:
VAPID_PRIVATE_KEY=<paste_private_key_from_step_1>
VAPID_PUBLIC_KEY=<paste_public_key_from_step_1>
VAPID_EMAIL=admin@ankur.health
```

**Frontend: Create/update d:\Ankur\ankur-frontend\.env.local**
```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<paste_public_key_from_step_1>
```

### 3. Install Backend Dependencies
```bash
cd d:\Ankur\Ankur_backend
pip install pywebpush
```

### 4. Start Backend
```bash
cd d:\Ankur\Ankur_backend
python main.py
# or: uvicorn main:app --reload
```

### 5. Start Frontend
```bash
cd d:\Ankur\ankur-frontend
npm install  # if needed
npm run dev
```

### 6. Test the Installation

1. **Open browser DevTools** (F12)
2. **Go to Application tab**
   - Click "Service Workers" → Should see registered `/sw.js`
   - Click "Manifest" → Should see loaded manifest.json with theme #9D1720
3. **Enable Notifications**
   - Go to dashboard
   - Click 🔔 "Enable Alerts" button in header
   - Approve browser permission popup
   - Button should turn green and say "Alerts Active"
4. **Create a Blood Request** (test endpoint)
   - Fill form and submit
   - Check backend logs for "Push notification sent to subscription..."
5. **Verify Subscription Stored**
   - Backend logs should show: "Subscription saved to backend successfully"
   - Database should have entry in push_subscriptions table

---

## 🔍 Verification Checklist

### Browser DevTools (F12)
- [ ] Application → Service Workers shows registered
- [ ] Application → Manifest shows theme_color: #9D1720
- [ ] Application → Cache Storage shows ankur-v1 cache
- [ ] Console shows no errors, check for subscription success
- [ ] Network tab shows POST to /api/notifications/subscribe with 200 OK

### Database
```sql
-- Run these queries:
SELECT COUNT(*) FROM push_subscriptions;  -- Should have entries after enable
SELECT * FROM push_subscriptions LIMIT 1;  -- Check structure
```

### Backend Logs
```
Service Worker registered: ...
Push subscription successful: ...
Subscription saved to backend successfully
Push notification sent to subscription ...
```

---

## 📱 Testing Push Notifications

### Test 1: Local Subscription Flow
```bash
# 1. Open dashboard, enable alerts
# 2. Check browser console: "Subscription saved to backend successfully"
# 3. Check database: SELECT COUNT(*) FROM push_subscriptions;
# Expected: At least 1 subscription stored
```

### Test 2: Create Emergency (via Postman/curl)
```bash
curl -X POST http://localhost:8000/api/request-blood \
  -H "Authorization: Bearer <valid_token>" \
  -F "hospital_name=Test Hospital" \
  -F "patient_age=30" \
  -F "contact_email=test@hospital.com" \
  -F "blood_type_needed=O-" \
  -F "urgency=CRITICAL" \
  -F "latitude=40.7128" \
  -F "longitude=-74.0060"
```

### Test 3: Receive Notification
```
User with matching blood type within 10km should see:
  Title: "CRITICAL: O- Required"
  Body: "A patient at Test Hospital needs your help. Tap to see details."
  Sound + Vibration: [200, 100, 200]ms
```

---

## 🐛 Common Issues & Fixes

### Issue: "Service Worker not registering"
**Solution:**
- Check manifest.json exists at `/public/manifest.json`
- Verify no JavaScript errors in console
- Ensure HTTPS or localhost
- Hard refresh: Ctrl+Shift+R

### Issue: "404 NotFound for /manifest.json"
**Solution:**
- Manifest file must be in `/public` folder (not `/public/manifest`)
- Filename exactly: `manifest.json`
- Next.js automatically serves public folder

### Issue: "Notification permission denied"
**Solution:**
- Check browser notification settings
- Reset in DevTools → Application → Notification permissions → Clear
- Click Enable button again

### Issue: "Subscription not sent to backend"
**Solution:**
- Check `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set in `.env.local`
- Check console for "VAPID public key not configured"
- Regenerate keys and update both `.env` files
- Hard refresh browser

### Issue: "Push notifications not received"
**Solution:**
- Verify user has enabled notifications (button shows "Alerts Active")
- Check backend logs for "dispatch_push_notifications" calls
- Verify VAPID keys match exactly in `.env` and `.env.local`
- Check database: user must be within 10km radius of emergency location
- Check database: user blood type must match emergency blood type

### Issue: "VAPID keys not configured" in backend logs
**Solution:**
- `VAPID_PRIVATE_KEY` must be set in Ankur_backend/.env
- Restart backend after adding to .env
- Verify with: `echo %VAPID_PRIVATE_KEY%` (Windows)

---

## 📊 Architecture Summary

```
User Enables Alerts
    ↓
browser.requestPermission() → User approves
    ↓
navigator.pushManager.subscribe(VAPID_PUBLIC_KEY)
    ↓
fetch POST /api/notifications/subscribe
    ↓
Backend stores in push_subscriptions table
    ↓
User clicks "Create Blood Request"
    ↓
POST /api/request-blood (creates emergency)
    ↓
dispatch_push_notifications() background task
    ↓
Query: SELECT subscriptions WHERE blood_type_match AND distance ≤ 10km
    ↓
For each subscription: pywebpush.send_notification(VAPID_PRIVATE_KEY)
    ↓
Service Worker receives push event
    ↓
self.registration.showNotification()
    ↓
User sees system notification (even if browser closed!)
    ↓
Click notification → Opens /dashboard?emergency=ID
```

---

## 🎯 Success Criteria

Your PWA implementation is complete when:

- [ ] ✅ manifest.json is loaded (DevTools → Manifest tab)
- [ ] ✅ Service Worker is registered (DevTools → Service Workers)
- [ ] ✅ 🔔 Button appears in dashboard header
- [ ] ✅ Clicking button shows "Alerts Active" (green button)
- [ ] ✅ Browser console shows "Subscription saved to backend successfully"
- [ ] ✅ Database has entry in push_subscriptions table
- [ ] ✅ Creating blood request shows "Push notification sent to..." in backend logs
- [ ] ✅ Subscribed user receives notification on their device

---

## 📝 Files Modified/Created

| File | Type | Status | Purpose |
|------|------|--------|---------|
| public/manifest.json | Created | ✅ | PWA metadata, icons, theme |
| public/sw.js | Created | ✅ | Service Worker, push handler |
| app/NotificationManager.tsx | Created | ✅ | Subscription UI component |
| app/layout.tsx | Modified | ✅ | Added manifest link & component |
| main.py | Modified | ✅ | Added push table, endpoints, dispatch |
| requirements.txt | Modified | ✅ | Added pywebpush |
| .env (backend) | To Create | ⏳ | VAPID keys needed |
| .env.local (frontend) | To Create | ⏳ | VAPID public key needed |

---

## 🔐 Security Notes

- 🔑 **Private Key**: Never commit to git, store in `.env` only
- 🔓 **Public Key**: Safe to expose in frontend env var (NEXT_PUBLIC_*)
- 📧 **VAPID Email**: Use valid contact email (shown to push service)
- 🔄 **Key Rotation**: If compromised, regenerate both keys
- 🛡️ **Subscription Validation**: Endpoints expire ~12 months (implement refresh)

---

## 📈 Performance

- Push dispatch is **non-blocking** (background task)
- Service Worker caches assets for **offline access**
- Geolocation filter uses **PostGIS spatial index** (fast)
- Distance calc: **Haversine formula** ≤ 10km
- Failed subscriptions **auto-removed** (410 Gone)

---

## ✨ What You Get

✅ **System-level notifications** (even browser closed)  
✅ **10km radius matching** (only relevant donors notified)  
✅ **Vibration alerts** (urgent [200,100,200]ms pattern)  
✅ **Click-through action** (taps open emergency details)  
✅ **Offline support** (cached assets load without internet)  
✅ **Installable app** (add to home screen on mobile)  
✅ **Theme color** (Deep Crimson #9D1720 matches brand)

---

## 🎓 Learning Resources

- Service Workers: https://mdn.io/Service_Worker_API
- Push API: https://mdn.io/Push_API
- Web App Manifest: https://mdn.io/Web_Manifest
- pywebpush: https://github.com/mozilla-services/PyWebPush

---

**Total Setup Time**: ~15 minutes (excluding dependencies install)

**Questions?** Check PWA_SETUP.md for detailed documentation
