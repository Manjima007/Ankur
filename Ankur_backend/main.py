from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from jose import JWTError, jwt
from datetime import datetime, timedelta
import os
import uuid
import base64
import hashlib
import hmac
import secrets
import bcrypt
import json
from twilio.rest import Client
try:
    from pywebpush import webpush, WebPushException
except ImportError:
    webpush = None
    WebPushException = Exception


def load_local_env_file() -> None:
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return

    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_local_env_file()

# --- 1. CONFIGURATION ---
DB_URI = os.getenv("SUPABASE_URI")
if not DB_URI:
    raise RuntimeError("SUPABASE_URI is required")

SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is required")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440 
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", r"https?://[\w\.-]+(:\d+)?")

# Twilio Config
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_SENDER = os.getenv("TWILIO_PHONE_NUMBER")

# VAPID Config for Push Notifications
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_EMAIL = os.getenv("VAPID_EMAIL", "admin@ankur.health")

app = FastAPI(title="Ankur Backend Engine")

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads", "requisitions")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "uploads")), name="uploads")

# --- 2. CORS SETTINGS (Crucial for Frontend-Backend communication) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = create_engine(DB_URI, pool_pre_ping=True)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

PBKDF2_ITERATIONS = 210000
REQUEST_STATUS_PENDING = "PENDING"
REQUEST_STATUS_ACCEPTED = "ACCEPTED"
REQUEST_STATUS_COMPLETED = "COMPLETED"
_is_production = os.getenv("PYTHON_ENV", "development").lower() == "production"
VERIFICATION_WINDOW_SECONDS = int(
    os.getenv("VERIFICATION_WINDOW_SECONDS", str(24 * 60 * 60 if _is_production else 60))
)


def normalize_blood_type(value: str | None) -> str:
    return (value or "").strip().upper()


def can_donate_to(donor_blood: str, requested_blood: str) -> bool:
    donor = normalize_blood_type(donor_blood)
    requested = normalize_blood_type(requested_blood)
    compatibility = {
        "O-": {"O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"},
        "O+": {"O+", "A+", "B+", "AB+"},
        "A-": {"A-", "A+", "AB-", "AB+"},
        "A+": {"A+", "AB+"},
        "B-": {"B-", "B+", "AB-", "AB+"},
        "B+": {"B+", "AB+"},
        "AB-": {"AB-", "AB+"},
        "AB+": {"AB+"},
    }
    return requested in compatibility.get(donor, set())


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    digest_b64 = base64.b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


def verify_password(password: str, stored_hash: str) -> bool:
    # Preferred format for new users.
    if stored_hash.startswith("pbkdf2_sha256$"):
        try:
            _, iterations, salt_b64, digest_b64 = stored_hash.split("$", 3)
            salt = base64.b64decode(salt_b64)
            expected = base64.b64decode(digest_b64)
            calculated = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
            return hmac.compare_digest(calculated, expected)
        except Exception:
            return False

    # Backward compatibility for existing raw bcrypt hashes.
    if stored_hash.startswith("$2"):
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
        except Exception:
            return False

    return False


def initialize_schema():
    # Ensure new eligibility and request state columns exist.
    with engine.connect() as conn:
        conn.execute(text("""
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS last_donation_date DATE,
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
        """))
        conn.execute(text("""
            ALTER TABLE emergencies
            ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open',
            ADD COLUMN IF NOT EXISTS accepted_by INTEGER,
            ADD COLUMN IF NOT EXISTS accepted_by_user_id INTEGER,
            ADD COLUMN IF NOT EXISTS accepted_by_id TEXT,
            ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS contact_phone TEXT,
            ADD COLUMN IF NOT EXISTS requisition_form_path TEXT;
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notifications (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                emergency_id TEXT,
                kind TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                is_read BOOLEAN DEFAULT FALSE
            );
        """))
        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_24h_reminder
            ON notifications (user_id, emergency_id, kind)
            WHERE kind = 'REQUEST_24H_REMINDER';
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
            ON push_subscriptions(user_id)
        """))
        conn.execute(text("""
            UPDATE emergencies
            SET status = CASE
                WHEN status ILIKE 'open' THEN :pending
                WHEN status ILIKE 'active' THEN :pending
                WHEN status ILIKE 'accepted' THEN :accepted
                WHEN status ILIKE 'completed' THEN :completed
                ELSE status
            END
            WHERE status IN ('open', 'active', 'accepted', 'completed');
        """), {
            "pending": REQUEST_STATUS_PENDING,
            "accepted": REQUEST_STATUS_ACCEPTED,
            "completed": REQUEST_STATUS_COMPLETED,
        })
        conn.execute(text("""
            UPDATE emergencies
            SET accepted_by_user_id = accepted_by
            WHERE accepted_by_user_id IS NULL AND accepted_by IS NOT NULL;
        """))
        conn.execute(text("""
            UPDATE emergencies
            SET accepted_by_id = CAST(accepted_by_user_id AS TEXT)
            WHERE accepted_by_id IS NULL AND accepted_by_user_id IS NOT NULL;
        """))

        # If notifications.user_id exists as BIGINT from older schema, migrate it to TEXT.
        user_id_type = conn.execute(text("""
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'notifications' AND column_name = 'user_id'
            LIMIT 1
        """)).scalar()
        if user_id_type and user_id_type.lower() != "text":
            conn.execute(text("""
                ALTER TABLE notifications
                ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT
            """))

        emergency_id_type = conn.execute(text("""
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'notifications' AND column_name = 'emergency_id'
            LIMIT 1
        """)).scalar()
        if emergency_id_type and emergency_id_type.lower() != "text":
            conn.execute(text("""
                ALTER TABLE notifications
                ALTER COLUMN emergency_id TYPE TEXT USING emergency_id::TEXT
            """))
        conn.commit()


initialize_schema()

# --- 3. SCHEMAS ---
class UserRegister(BaseModel):
    name: str
    email: str
    phone: str
    age: int
    blood_type: str
    password: str
    latitude: float
    longitude: float

class BloodRequest(BaseModel):
    hospital_name: str
    patient_age: int
    contact_email: str
    contact_phone: str | None = None
    blood_type_needed: str
    urgency: str
    latitude: float
    longitude: float
    status: str = REQUEST_STATUS_PENDING
    accepted_by_id: uuid.UUID | None = None
    accepted_at: datetime | None = None


class AcceptRequest(BaseModel):
    emergency_id: str


class CompleteRequest(BaseModel):
    emergency_id: str


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys


class SubscribeRequest(BaseModel):
    subscription: PushSubscription
    user_id: str


class UnsubscribeRequest(BaseModel):
    user_id: str
    endpoint: str

# --- 4. SECURITY & ALERTS ---
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict[str, str]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return {"id": user_id}
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

def send_whatsapp_alerts(phone_numbers: list, hospital_name: str, blood_type: str):
    if not TWILIO_SID or "your_" in TWILIO_SID:
        print(f"DEBUG: WhatsApp simulation for {blood_type} at {hospital_name} to: {phone_numbers}")
        return
        
    client = Client(TWILIO_SID, TWILIO_TOKEN)
    for number in phone_numbers:
        try:
            formatted_number = f"whatsapp:+91{number}" if not number.startswith('+') else f"whatsapp:{number}"
            client.messages.create(
                from_=TWILIO_SENDER,
                body=f"🚨 ANKUR EMERGENCY: {blood_type} needed at {hospital_name}. Check the app to respond!",
                to=formatted_number
            )
        except Exception as e:
            print(f"Twilio Error for {number}: {e}")


def create_notification(conn, user_id: str, emergency_id: str | None, kind: str, message: str):
    conn.execute(
        text("""
            INSERT INTO notifications (user_id, emergency_id, kind, message, created_at, is_read)
            VALUES (:user_id, :emergency_id, :kind, :message, NOW(), FALSE)
        """),
        {
            "user_id": user_id,
            "emergency_id": emergency_id,
            "kind": kind,
            "message": message,
        },
    )


def dispatch_push_notifications(emergency_id: str, hospital_name: str, blood_type: str, latitude: float, longitude: float):
    """
    Find users within 10km radius with matching blood type and send push notifications.
    Runs in background task to avoid blocking request.
    """
    if not webpush or not VAPID_PRIVATE_KEY or "your_" in VAPID_PRIVATE_KEY:
        print(f"DEBUG: Push notification simulation for {blood_type} at {hospital_name}")
        return

    # Query matching users within 10km radius
    query = text("""
        SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
        FROM push_subscriptions ps
        JOIN users u ON ps.user_id = u.id
        WHERE u.blood_type = :blood_type
          AND u.is_active = TRUE
          AND (6371 * ACOS(
            COS(RADIANS(:lat)) * COS(RADIANS(ST_Y(u.location::geometry))) *
            COS(RADIANS(ST_X(u.location::geometry)) - RADIANS(:lon)) +
            SIN(RADIANS(:lat)) * SIN(RADIANS(ST_Y(u.location::geometry)))
          )) <= 10
    """)

    with engine.connect() as conn:
        subscriptions = conn.execute(query, {
            "blood_type": blood_type,
            "lat": latitude,
            "lon": longitude
        }).fetchall()

    notification_payload = {
        "title": f"CRITICAL: {blood_type} Required",
        "body": f"A patient at {hospital_name} needs your help. Tap to see details.",
        "icon": "/ankur_logo.png",
        "badge": "/ankur_logo.png",
        "tag": f"ankur-{emergency_id}",
        "vibrate": [200, 100, 200],
        "data": {
            "emergencyId": emergency_id,
            "url": f"/dashboard?emergency={emergency_id}"
        }
    }

    failed_subscription_ids = []
    
    for subscription in subscriptions:
        try:
            subscription_obj = {
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh,
                    "auth": subscription.auth
                }
            }
            
            webpush(
                subscription_info=subscription_obj,
                data=json.dumps(notification_payload),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_EMAIL}
            )
            print(f"Push notification sent to subscription {subscription.id}")
        except WebPushException as e:
            print(f"Push notification failed for subscription {subscription.id}: {str(e)}")
            # If subscription is invalid (410 Gone), mark for removal
            if "410" in str(e) or "expired" in str(e).lower():
                failed_subscription_ids.append(subscription.id)
        except Exception as e:
            print(f"Unexpected error sending push notification: {str(e)}")

    # Clean up failed subscriptions
    if failed_subscription_ids:
        with engine.connect() as conn:
            placeholders = ','.join([str(id) for id in failed_subscription_ids])
            conn.execute(text(f"""
                DELETE FROM push_subscriptions
                WHERE id IN ({placeholders})
            """))
            conn.commit()


# --- 5. ENDPOINTS ---

@app.get("/")
def health_check():
    return {"status": "Ankur Backend is Online", "database": "Connected"}

@app.post("/register")
def register_user(user: UserRegister):
    hashed_password = hash_password(user.password)
    query = text("""
        INSERT INTO users (name, email, phone, age, blood_type, password, location, is_active, last_donation_date)
        VALUES (:name, :email, :phone, :age, :blood_type, :password, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), TRUE, NULL)
    """)
    with engine.connect() as conn:
        try:
            conn.execute(query, {
                "name": user.name, "email": user.email, "phone": user.phone, 
                "age": user.age, "blood_type": user.blood_type, "password": hashed_password,
                "lon": user.longitude, "lat": user.latitude
            })
            conn.commit()
            return {"status": "success", "message": "User registered"}
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Registration failed: {str(e)}")

@app.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    query = text("SELECT id, password FROM users WHERE email = :email")
    with engine.connect() as conn:
        user = conn.execute(query, {"email": form_data.username}).fetchone()
        if not user or not verify_password(form_data.password, user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        token = create_access_token({"sub": str(user.id)})
        return {"access_token": token, "token_type": "bearer"}

@app.post("/api/request-blood")
async def request_blood(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    hospital_name: str = Form(...),
    patient_age: int = Form(...),
    contact_email: str = Form(...),
    contact_phone: str | None = Form(None),
    blood_type_needed: str = Form(...),
    urgency: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    requisition_form: UploadFile | None = File(None),
):
    requisition_form_path = None
    if requisition_form is not None:
        allowed_types = {"application/pdf", "image/jpeg", "image/png"}
        if requisition_form.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Requisition form must be PDF, JPG, or PNG")

        data = await requisition_form.read()
        if len(data) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Requisition form must be <= 5MB")

        original_name = requisition_form.filename or "requisition"
        ext = os.path.splitext(original_name)[1].lower()
        safe_ext = ext if ext in {".pdf", ".jpg", ".jpeg", ".png"} else ".bin"
        file_name = f"{uuid.uuid4().hex}{safe_ext}"
        file_path = os.path.join(UPLOAD_DIR, file_name)
        with open(file_path, "wb") as output_file:
            output_file.write(data)

        requisition_form_path = f"/uploads/requisitions/{file_name}"

    # 1. Log the emergency
    insert_query = text("""
        INSERT INTO emergencies (
            requested_by,
            hospital_name,
            patient_age,
            contact_email,
            contact_phone,
            requisition_form_path,
            blood_type_needed,
            urgency,
            status,
            location,
            created_at
        )
        VALUES (
            :user_id,
            :hosp,
            :age,
            :email,
            :phone,
            :requisition_form_path,
            :blood,
            :urgency,
            :status,
            ST_SetSRID(ST_MakePoint(:lon, :lat), 4326),
            NOW()
        )
        RETURNING id
    """)
    
    # 2. Find donors by blood type and eligibility (90-day donation rule)
    match_query = text("""
        SELECT phone FROM users 
        WHERE blood_type = :blood
        AND is_active = TRUE
        AND (last_donation_date IS NULL OR last_donation_date <= CURRENT_DATE - INTERVAL '90 days')
        AND id != :user_id
    """)
    
    with engine.connect() as conn:
        result = conn.execute(insert_query, {
            "user_id": current_user["id"], "hosp": hospital_name, "age": patient_age,
            "email": contact_email, "phone": contact_phone,
            "requisition_form_path": requisition_form_path,
            "blood": blood_type_needed, "urgency": urgency,
            "status": REQUEST_STATUS_PENDING,
            "lon": longitude, "lat": latitude
        })
        emergency_id = str(result.scalar())
        
        matches = conn.execute(match_query, {
            "blood": blood_type_needed, "user_id": current_user["id"]
        }).fetchall()
        conn.commit()
        
    matched_phones = [m[0] for m in matches]
    if matched_phones:
        background_tasks.add_task(send_whatsapp_alerts, matched_phones, hospital_name, blood_type_needed)
    
    # Dispatch push notifications to matching users within 10km radius
    background_tasks.add_task(
        dispatch_push_notifications,
        emergency_id,
        hospital_name,
        blood_type_needed,
        latitude,
        longitude
    )
        
    return {"status": "broadcasted", "donors_found": len(matched_phones), "emergency_id": emergency_id}


@app.get("/api/me")
def get_my_profile(current_user: dict = Depends(get_current_user)):
    query = text("""
        SELECT
            id,
            name,
            email,
            phone,
            age,
            blood_type,
            is_active,
            last_donation_date,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude
        FROM users
        WHERE id = :user_id
    """)
    with engine.connect() as conn:
        user = conn.execute(query, {"user_id": current_user["id"]}).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "age": user.age,
        "blood_type": user.blood_type,
        "is_active": user.is_active,
        "last_donation_date": user.last_donation_date.isoformat() if user.last_donation_date else None,
        "latitude": float(user.latitude) if user.latitude is not None else None,
        "longitude": float(user.longitude) if user.longitude is not None else None,
    }


@app.get("/api/emergencies")
def list_emergencies(current_user: dict = Depends(get_current_user)):
    user_query = text("""
        SELECT id, name, blood_type, is_active, last_donation_date
        FROM users
        WHERE id = :user_id
    """)
    emergencies_query = text("""
        SELECT
            e.id::text AS id,
            e.requested_by::text AS requested_by,
            e.hospital_name,
            e.blood_type_needed,
            e.urgency,
            e.contact_email,
            e.contact_phone,
            e.patient_age,
            e.requisition_form_path,
            e.status,
            e.accepted_by_user_id,
            COALESCE(e.accepted_by_id, e.accepted_by_user_id::text) AS accepted_by_id,
            au.name AS accepted_by_name,
            e.created_at,
            e.accepted_at,
            ST_Y(e.location::geometry) AS latitude,
            ST_X(e.location::geometry) AS longitude
        FROM emergencies e
                LEFT JOIN users au ON CAST(au.id AS TEXT) = COALESCE(e.accepted_by_id, CAST(e.accepted_by_user_id AS TEXT))
        WHERE e.status = :pending_status
          AND e.requested_by != :current_user_id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 100
    """)

    with engine.connect() as conn:
        user = conn.execute(user_query, {"user_id": current_user["id"]}).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        rows = conn.execute(
            emergencies_query,
            {"pending_status": REQUEST_STATUS_PENDING, "current_user_id": current_user["id"]},
        ).fetchall()

        conn.execute(
            text("""
                INSERT INTO notifications (user_id, emergency_id, kind, message, created_at, is_read)
                SELECT
                    CAST(e.requested_by AS TEXT),
                    e.id::text,
                    'REQUEST_24H_REMINDER',
                    'It has been 24 hours. Did the donor arrive? Please confirm to close the request.',
                    NOW(),
                    FALSE
                FROM emergencies e
                WHERE e.requested_by = :requester_id
                  AND e.status = :accepted_status
                  AND e.accepted_at IS NOT NULL
                  AND e.accepted_at <= NOW() - INTERVAL '24 hours'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM notifications n
                                        WHERE CAST(n.user_id AS TEXT) = CAST(e.requested_by AS TEXT)
                                            AND n.emergency_id::text = e.id::text
                      AND n.kind = 'REQUEST_24H_REMINDER'
                  )
            """),
            {"requester_id": current_user["id"], "accepted_status": REQUEST_STATUS_ACCEPTED},
        )
        conn.commit()

    eligible = bool(user.is_active)
    eligibility_reason = "Eligible to accept" if eligible else "Account is deactivated"

    emergencies = []
    for row in rows:
        is_compatible = can_donate_to(user.blood_type, row.blood_type_needed)
        can_accept = row.status == REQUEST_STATUS_PENDING and is_compatible and eligible and row.requested_by != current_user["id"]
        reason = None
        if row.status != REQUEST_STATUS_PENDING:
            reason = "Already accepted"
        elif row.requested_by == current_user["id"]:
            reason = "Your own request"
        elif not is_compatible:
            reason = "Blood type not compatible"
        elif not eligible:
            reason = eligibility_reason

        emergencies.append({
            "id": str(row.id),
            "requested_by": str(row.requested_by),
            "hospital_name": row.hospital_name,
            "blood_type_needed": row.blood_type_needed,
            "urgency": row.urgency,
            "contact_email": row.contact_email,
            "contact_phone": row.contact_phone,
            "patient_age": row.patient_age,
            "requisition_form_path": row.requisition_form_path,
            "status": row.status,
            "accepted_by": str(row.accepted_by_user_id) if row.accepted_by_user_id is not None else None,
            "accepted_by_user_id": str(row.accepted_by_user_id) if row.accepted_by_user_id is not None else None,
            "accepted_by_id": row.accepted_by_id,
            "accepted_by_name": row.accepted_by_name,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
            "latitude": float(row.latitude) if row.latitude is not None else None,
            "longitude": float(row.longitude) if row.longitude is not None else None,
            "is_compatible": is_compatible,
            "can_accept": can_accept,
            "accept_block_reason": reason,
        })

    return {"items": emergencies}


@app.get("/api/my-requests")
def list_my_requests(current_user: dict = Depends(get_current_user)):
    query = text("""
        SELECT
            e.id::text AS id,
            e.requested_by::text AS requested_by,
            e.hospital_name,
            e.blood_type_needed,
            e.urgency,
            e.contact_email,
            e.contact_phone,
            e.patient_age,
            e.requisition_form_path,
            e.status,
            e.accepted_by_user_id,
            COALESCE(e.accepted_by_id, e.accepted_by_user_id::text) AS accepted_by_id,
            au.name AS accepted_by_name,
            e.created_at,
            e.accepted_at,
            ST_Y(e.location::geometry) AS latitude,
            ST_X(e.location::geometry) AS longitude
        FROM emergencies e
                LEFT JOIN users au ON CAST(au.id AS TEXT) = COALESCE(e.accepted_by_id, CAST(e.accepted_by_user_id AS TEXT))
        WHERE e.requested_by = :current_user_id
          AND e.status != :completed_status
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 100
    """)

    with engine.connect() as conn:
        rows = conn.execute(
            query,
            {
                "current_user_id": current_user["id"],
                "completed_status": REQUEST_STATUS_COMPLETED,
            },
        ).fetchall()

    items = []
    for row in rows:
        items.append({
            "id": str(row.id),
            "requested_by": str(row.requested_by),
            "hospital_name": row.hospital_name,
            "blood_type_needed": row.blood_type_needed,
            "urgency": row.urgency,
            "contact_email": row.contact_email,
            "contact_phone": row.contact_phone,
            "patient_age": row.patient_age,
            "requisition_form_path": row.requisition_form_path,
            "status": row.status,
            "accepted_by": str(row.accepted_by_user_id) if row.accepted_by_user_id is not None else None,
            "accepted_by_user_id": str(row.accepted_by_user_id) if row.accepted_by_user_id is not None else None,
            "accepted_by_id": row.accepted_by_id,
            "accepted_by_name": row.accepted_by_name,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
            "latitude": float(row.latitude) if row.latitude is not None else None,
            "longitude": float(row.longitude) if row.longitude is not None else None,
        })

    return {"items": items}


@app.get("/api/blood-banks")
def list_blood_banks(query: str = ""):
    sql = text("""
        SELECT name, address, phone, latitude, longitude
        FROM blood_banks
        WHERE (
            :query = '' OR
            name ILIKE :like_query OR
            address ILIKE :like_query
        )
        ORDER BY name
        LIMIT 50
    """)
    like_query = f"%{query.strip()}%"
    with engine.connect() as conn:
        rows = conn.execute(sql, {"query": query.strip(), "like_query": like_query}).fetchall()

    items = []
    for i, row in enumerate(rows, start=1):
        items.append({
            "id": i,
            "name": row.name,
            "address": row.address,
            "phone": row.phone,
            "latitude": float(row.latitude) if row.latitude is not None else None,
            "longitude": float(row.longitude) if row.longitude is not None else None,
        })

    return {"items": items}


@app.post("/api/accept-request")
def accept_request(payload: AcceptRequest, current_user: dict = Depends(get_current_user)):
    """
    Testing override: donor eligibility cooldown is bypassed.
    """
    donor_query = text("""
        SELECT id, name, blood_type, is_active, last_donation_date
        FROM users
        WHERE id = :user_id
    """)
    emergency_query = text("""
        SELECT id, requested_by, blood_type_needed, status
        FROM emergencies
        WHERE id = :request_id
    """)
    accept_emergency_query = text("""
        UPDATE emergencies
        SET status = :accepted_status,
            accepted_by_id = :accepted_by_id,
            accepted_at = NOW()
        WHERE id = :request_id
    """)
    update_donation_query = text("""
        UPDATE users
        SET last_donation_date = CURRENT_DATE, is_active = TRUE
        WHERE id = :user_id
    """)

    with engine.connect() as conn:
        donor = conn.execute(donor_query, {"user_id": current_user["id"]}).fetchone()
        if not donor:
            raise HTTPException(status_code=404, detail="Donor not found")
        if not donor.is_active:
            raise HTTPException(status_code=403, detail="Account is deactivated")

        request_id = str(payload.emergency_id)
        emergency = conn.execute(emergency_query, {"request_id": request_id}).fetchone()
        if not emergency:
            raise HTTPException(status_code=404, detail="Emergency request not found")
        if emergency.status != REQUEST_STATUS_PENDING:
            raise HTTPException(status_code=409, detail="Request already accepted")
        if str(emergency.requested_by) == current_user["id"]:
            raise HTTPException(status_code=400, detail="You cannot accept your own request")
        if not can_donate_to(donor.blood_type, emergency.blood_type_needed):
            raise HTTPException(status_code=400, detail="Blood type not compatible")

        conn.execute(
            accept_emergency_query,
            {
                "user_id": current_user["id"],
                "request_id": request_id,
                "accepted_status": REQUEST_STATUS_ACCEPTED,
                "accepted_by_id": str(current_user["id"]),
            },
        )
        conn.execute(update_donation_query, {"user_id": current_user["id"]})
        create_notification(
            conn,
            user_id=str(emergency.requested_by),
            emergency_id=request_id,
            kind="REQUEST_ACCEPTED",
            message=f"Your request has been accepted by {donor.name}. They should arrive soon.",
        )
        conn.commit()

    return {"status": "accepted", "message": "Request accepted successfully"}


@app.post("/api/complete-request")
def complete_request(payload: CompleteRequest, current_user: dict = Depends(get_current_user)):
    with engine.connect() as conn:
        request_id = str(payload.emergency_id)
        emergency = conn.execute(
            text("""
                SELECT id, requested_by, status, accepted_at
                FROM emergencies
                WHERE id = :request_id
            """),
            {"request_id": request_id},
        ).fetchone()

        if not emergency:
            raise HTTPException(status_code=404, detail="Emergency request not found")
        if str(emergency.requested_by) != current_user["id"]:
            raise HTTPException(status_code=403, detail="Only the requester can mark this as completed")
        if emergency.status != REQUEST_STATUS_ACCEPTED:
            raise HTTPException(status_code=400, detail="Only accepted requests can be completed")
        if emergency.accepted_at is None:
            raise HTTPException(status_code=400, detail="Invalid accepted timestamp")

        elapsed = datetime.utcnow() - emergency.accepted_at
        if elapsed < timedelta(seconds=VERIFICATION_WINDOW_SECONDS):
            raise HTTPException(
                status_code=400,
                detail="Done is available only after the verification window from acceptance",
            )

        conn.execute(
            text("""
                UPDATE emergencies
                SET status = :completed_status
                WHERE id = :request_id
            """),
            {"completed_status": REQUEST_STATUS_COMPLETED, "request_id": request_id},
        )
        conn.commit()

    return {"status": "completed", "message": "Request marked as completed"}


@app.get("/api/notifications")
def list_notifications(current_user: dict = Depends(get_current_user)):
    with engine.connect() as conn:
        rows = conn.execute(
            text("""
                SELECT id, emergency_id, kind, message, created_at, is_read
                FROM notifications
                WHERE CAST(user_id AS TEXT) = :user_id
                ORDER BY created_at DESC, id DESC
                LIMIT 50
            """),
            {"user_id": current_user["id"]},
        ).fetchall()

    return {
        "items": [
            {
                "id": str(row.id),
                "emergency_id": str(row.emergency_id) if row.emergency_id is not None else None,
                "kind": row.kind,
                "message": row.message,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "is_read": row.is_read,
            }
            for row in rows
        ]
    }


@app.post("/api/notifications/subscribe")
def subscribe_to_push_notifications(payload: SubscribeRequest):
    """
    Register a user's push notification subscription.
    Frontend sends VAPID-signed subscription object to store endpoint + keys.
    """
    user_id = payload.user_id
    endpoint = payload.subscription.endpoint
    p256dh = payload.subscription.keys.p256dh
    auth = payload.subscription.keys.auth

    query = text("""
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
        VALUES (:user_id, :endpoint, :p256dh, :auth, NOW())
        ON CONFLICT (endpoint) DO UPDATE
        SET p256dh = :p256dh, auth = :auth
    """)

    with engine.connect() as conn:
        try:
            conn.execute(query, {
                "user_id": user_id,
                "endpoint": endpoint,
                "p256dh": p256dh,
                "auth": auth,
            })
            conn.commit()
            return {"status": "subscribed", "message": "Push notifications enabled"}
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Subscription failed: {str(e)}")


@app.post("/api/notifications/unsubscribe")
def unsubscribe_from_push_notifications(payload: UnsubscribeRequest):
    """
    Remove a user's push notification subscription.
    """
    user_id = payload.user_id
    endpoint = payload.endpoint

    query = text("""
        DELETE FROM push_subscriptions
        WHERE user_id = :user_id AND endpoint = :endpoint
    """)

    with engine.connect() as conn:
        try:
            conn.execute(query, {
                "user_id": user_id,
                "endpoint": endpoint,
            })
            conn.commit()
            return {"status": "unsubscribed", "message": "Push notifications disabled"}
        except Exception as e:
            conn.rollback()
            raise HTTPException(status_code=400, detail=f"Unsubscription failed: {str(e)}")
