import os
import re
import time
import requests
import pandas as pd
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from sqlalchemy import create_engine, text, exc

# 1. INITIALIZATION
load_dotenv(override=True)

API_KEY = os.getenv("DATA_GOV_API_KEY")
DB_URI = os.getenv("SUPABASE_POOLER_URI") or os.getenv("SUPABASE_URI")
RESOURCE_ID = "fced6df9-a360-4e08-8ca0-f283fc74ce15"

# Configuration
ENABLE_EXTRA_SCRAPE = True
EXTRA_LIST_URL = "https://www.myvisitinghours.org/blood-bank/city.php?srchtxt=west-bengal"
EXTRA_BASE_URL = "https://www.myvisitinghours.org"

print(f"✓ API_KEY loaded: {bool(API_KEY)}")
print(f"✓ DB_URI loaded: {bool(DB_URI)}")

# 2. DATABASE ENGINE (IPv6 & DNS FIX)
def get_engine():
    """Handles the 'Unknown server error' by disabling GSS encryption and using the pooler."""
    try:
        # Standardize to postgresql:// protocol
        target_uri = DB_URI
        if target_uri.startswith("postgres://"):
            target_uri = target_uri.replace("postgres://", "postgresql://", 1)

        # connect_args fixes the DNS/IPv6 handshake issue found in Kolkata networks
        engine = create_engine(
            target_uri, 
            pool_pre_ping=True, 
            connect_args={
                "connect_timeout": 20,
                "gssencmode": "disable" 
            }
        )
        
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"✓ Connected to Supabase via: {target_uri.split('@')[-1]}")
        return engine
    except Exception as e:
        print(f"⚠ Connection failed: {e}")
        print("\nDEBUG TIPS:")
        print("1. Ensure your .env has port :6543 (Transaction Pooler).")
        print("2. Switch to a MOBILE HOTSPOT if you are on a restricted Wi-Fi.")
        raise RuntimeError("Database connection could not be established.")

# 3. UTILITIES
def normalize_text(s: str) -> str:
    if not s: return ""
    return re.sub(r"\s+", " ", str(s)).strip()

def is_west_bengal(state_str: str) -> bool:
    if not state_str: return False
    s = str(state_str).upper().replace(" ", "")
    return any(x in s for x in ["WESTBENGAL", "WB"])

def extract_phone(text_data: str) -> str:
    matches = re.findall(r"(?:\+91[\s-]?)?[6-9]\d{9}|\d{3,5}[-\s]?\d{5,8}", text_data or "")
    return ", ".join(list(dict.fromkeys([normalize_text(m) for m in matches])))

# 4. SCRAPER LOGIC
def parse_detail_page(html: str, fallback_name: str = "") -> dict:
    soup = BeautifulSoup(html, "html.parser")
    # Identify title
    h1 = soup.find("h1")
    name = normalize_text(h1.get_text()) if h1 else fallback_name
    
    address, phone = "", ""
    for tr in soup.select("tr"):
        cells = tr.find_all(["th", "td"])
        if len(cells) < 2: continue
        key = cells[0].get_text().lower()
        val = normalize_text(cells[1].get_text())
        if any(k in key for k in ["address", "location"]): address = val
        if any(k in key for k in ["phone", "contact", "mobile"]): phone = extract_phone(val) or val

    return {"name": name, "address": address, "phone": phone}

def fetch_extra_wb_data() -> pd.DataFrame:
    print("\n[Scraper] Starting deep-scrape of myvisitinghours...")
    # Real browser header to prevent blocks
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        r = requests.get(EXTRA_LIST_URL, headers=headers, timeout=20)
        soup = BeautifulSoup(r.text, "html.parser")
        
        links = set()
        for a in soup.find_all("a", href=True):
            href = a['href']
            if "details.php" in href:
                links.add(urljoin(EXTRA_BASE_URL, href))
        
        print(f"[Scraper] Found {len(links)} detailed links. Starting parsing...")
        
        rows = []
        for i, url in enumerate(links, 1):
            try:
                res = requests.get(url, headers=headers, timeout=15)
                data = parse_detail_page(res.text, fallback_name=f"Blood Bank {i}")
                if data["name"] and data["address"]:
                    rows.append(data)
                if i % 10 == 0: print(f"  Processed {i}/{len(links)}...")
                time.sleep(1) # Polite delay
            except: continue
            
        return pd.DataFrame(rows)
    except Exception as e:
        print(f"⚠ Scraper failed: {e}")
        return pd.DataFrame()

# 5. MAIN FLOW
def main():
    engine = get_engine()

    # Part A: Gov API
    print("\n[Gov API] Fetching official records...")
    try:
        url = f"https://api.data.gov.in/resource/{RESOURCE_ID}?api-key={API_KEY}&format=json&limit=5000"
        res = requests.get(url, timeout=20)
        api_data = res.json().get("records", [])
        df_gov = pd.DataFrame(api_data)
        
        # Handle dynamic column naming in gov records
        state_col = next((c for c in df_gov.columns if 'state' in c.lower()), None)
        if state_col:
            df_gov = df_gov[df_gov[state_col].apply(is_west_bengal)]
        
        mapping = {
            next((c for c in df_gov.columns if 'name' in c.lower())): 'name',
            next((c for c in df_gov.columns if 'address' in c.lower())): 'address',
            next((c for c in df_gov.columns if 'contact' in c.lower())): 'phone',
            next((c for c in df_gov.columns if 'lat' in c.lower())): 'latitude',
            next((c for c in df_gov.columns if 'long' in c.lower())): 'longitude',
        }
        df_gov = df_gov.rename(columns=mapping)[['name', 'address', 'phone', 'latitude', 'longitude']]
    except Exception as e:
        print(f"⚠ Gov API skipped: {e}")
        df_gov = pd.DataFrame()

    # Part B: Scraper
    df_extra = fetch_extra_wb_data() if ENABLE_EXTRA_SCRAPE else pd.DataFrame()

    # Part C: Combine
    final_df = pd.concat([df_gov, df_extra], ignore_index=True)
    final_df['name'] = final_df['name'].map(normalize_text)
    final_df['address'] = final_df['address'].map(normalize_text)
    final_df = final_df.drop_duplicates(subset=['name'], keep='first')
    
    # Part D: Injection
    print(f"\n[Database] Injecting {len(final_df)} records into Supabase...")
    
    insert_query = text("""
        INSERT INTO blood_banks (name, address, phone, latitude, longitude)
        SELECT :name, :address, :phone, :latitude, :longitude
        WHERE NOT EXISTS (
            SELECT 1 FROM blood_banks 
            WHERE LOWER(name) = LOWER(:name)
        );
    """)

    with engine.begin() as conn:
        for _, row in final_df.iterrows():
            # Ensure latitude/longitude are float or None (preventing string errors)
            d = row.to_dict()
            try:
                d['latitude'] = float(d['latitude']) if d.get('latitude') else None
                d['longitude'] = float(d['longitude']) if d.get('longitude') else None
            except:
                d['latitude'], d['longitude'] = None, None
            
            conn.execute(insert_query, d)
            
    # Part E: PostGIS
    try:
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE blood_banks 
                SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
                WHERE location IS NULL AND longitude IS NOT NULL AND latitude IS NOT NULL;
            """))
        print("✓ PostGIS locations indexed.")
    except Exception as e:
        print(f"⚠ PostGIS update skipped: {e}")

    print("\n✅ SEEDING COMPLETE! Your Ankur Crimson dashboard is ready.")

if __name__ == "__main__":
    main()