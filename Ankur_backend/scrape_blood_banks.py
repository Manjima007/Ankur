"""
Scrape West Bengal blood bank data from myvisitinghours.org
and insert into the Ankur blood_banks database table.

Usage:
    python scrape_blood_banks.py

Requires: requests, beautifulsoup4, sqlalchemy, psycopg2-binary
    pip install requests beautifulsoup4 sqlalchemy psycopg2-binary
"""

import os
import re
import sys
import time
import json
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from sqlalchemy import create_engine, text


def log(msg: str):
    """Print with immediate flush so output appears in real time."""
    print(msg, flush=True)


# ─── 1. Configuration ───────────────────────────────────────────────

LISTING_URL = "https://www.myvisitinghours.org/blood-bank/city.php?srchtxt=west-bengal"
BASE_URL = "https://www.myvisitinghours.org"
RATE_LIMIT_SECONDS = 0.5  # polite delay between requests
REQUEST_TIMEOUT = 20
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    )
}
OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "scraped_blood_banks.json")


# ─── 2. Load .env ───────────────────────────────────────────────────

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


load_env()


# ─── 3. Helpers ──────────────────────────────────────────────────────

def normalize_text(s: str) -> str:
    """Collapse whitespace and strip."""
    if not s:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def extract_phone_numbers(raw_text: str) -> str:
    """Extract phone numbers from a raw string."""
    if not raw_text:
        return ""
    # Match Indian phone patterns
    matches = re.findall(
        r"(?:\+91[\s-]?)?(?:0\d{2,4}[\s-]?)?\d{6,10}",
        raw_text,
    )
    # Deduplicate preserving order
    seen = set()
    unique = []
    for m in matches:
        cleaned = normalize_text(m)
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            unique.append(cleaned)
    return ", ".join(unique)


# ─── 4. Step 1: Get all detail page URLs ────────────────────────────

def fetch_listing_urls() -> list[str]:
    """Fetch the listing page and extract unique detail page URLs."""
    log(f"[1/3] Fetching listing page: {LISTING_URL}")
    resp = requests.get(LISTING_URL, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    urls = set()

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]
        # Resolve relative URLs against the listing page URL
        full_url = urljoin(LISTING_URL, href)
        # Only care about blood-bank detail pages
        if "/blood-bank/" not in full_url:
            continue
        # Skip pages with file extensions (city.php, sitemap.xml, etc)
        slug = full_url.split("/blood-bank/")[-1]
        if "." in slug.split("-")[-1]:  # extension in the last segment
            continue
        # Must end with a numeric ID like -2824
        match = re.search(r"-(\d+)$", slug)
        if not match:
            continue
        bank_id = int(match.group(1))
        # Only include WB blood banks (IDs 2824-2947)
        if 2824 <= bank_id <= 2947:
            urls.add(full_url)

    sorted_urls = sorted(urls)
    log(f"    Found {len(sorted_urls)} unique West Bengal blood bank pages")
    return sorted_urls


# ─── 5. Step 2: Scrape each detail page ─────────────────────────────

def parse_detail_page(url: str) -> dict | None:
    """
    Fetch a detail page and extract name, address, phone.
    
    The title format is:
      "Hospital Name Blood Bank  Address City address, reviews, phone number & timinigs"
    
    Phone numbers are in <a href="tel:..."> links.
    Address info is also derivable from title.  
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        log(f"    [WARN] Failed to fetch {url}: {e}")
        return None

    soup = BeautifulSoup(resp.text, "html.parser")

    # --- Extract name from <title> ---
    title_tag = soup.find("title")
    title_text = normalize_text(title_tag.get_text()) if title_tag else ""

    # Title pattern: "Name Blood Bank  Address City address, reviews, phone number & timinigs"
    # Split on " address, reviews" to get the useful part
    useful_part = re.split(r"\s+address,?\s+reviews", title_text, flags=re.IGNORECASE)[0]

    # The useful part is: "Name Blood Bank  Address City"
    # Try to split on double space (between name and address)
    parts = re.split(r"\s{2,}", useful_part, maxsplit=1)
    
    name = normalize_text(parts[0]) if parts else ""
    address = normalize_text(parts[1]) if len(parts) > 1 else ""

    # Also try <h1> tag for a cleaner name
    h1 = soup.find("h1")
    if h1:
        h1_name = normalize_text(h1.get_text())
        if h1_name and len(h1_name) > 3:
            # Remove " in City, State" suffix that h1 tags include
            h1_name = re.sub(r"\s+in\s+.*$", "", h1_name)
            if h1_name:
                name = h1_name

    # --- Extract phone from tel: links ---
    phone = ""
    tel_links = soup.find_all("a", href=re.compile(r"^tel:"))
    if tel_links:
        phone_parts = []
        for tel_link in tel_links:
            tel_text = normalize_text(tel_link.get_text())
            if tel_text:
                phone_parts.append(tel_text)
        phone = ", ".join(phone_parts)

    # --- Extract address from structured data if available ---
    # Look for address in meta tags or structured elements
    for meta in soup.find_all("meta"):
        if meta.get("name", "").lower() == "description":
            desc = meta.get("content", "")
            if desc and not address:
                # Try to extract address from description
                addr_match = re.search(r"address[:\s]+(.+?)(?:,\s*reviews|phone|$)", desc, re.IGNORECASE)
                if addr_match:
                    address = normalize_text(addr_match.group(1))

    # Also look for address in breadcrumb (city info)
    breadcrumbs = soup.find_all("a", href=re.compile(r"city\.php\?srchtxt="))
    city = ""
    for bc in breadcrumbs:
        bc_text = normalize_text(bc.get_text()).replace("»", "").strip()
        if bc_text and bc_text.lower() not in ("blood bank", "home", ""):
            city = bc_text

    # Append city to address if not already there
    if city and city.lower() not in (address or "").lower():
        if address:
            address = f"{address}, {city}"
        else:
            address = city

    # Add "West Bengal" if not in address
    if address and "west bengal" not in address.lower():
        address = f"{address}, West Bengal"
    elif not address:
        address = "West Bengal"

    if not name:
        return None

    return {
        "name": name,
        "address": address,
        "phone": phone,
        "url": url,
    }


def scrape_all_detail_pages(urls: list[str]) -> list[dict]:
    """Scrape all detail pages with rate limiting and progress reporting."""
    total = len(urls)
    results = []
    failed = 0

    log(f"\n[2/3] Scraping {total} detail pages (with {RATE_LIMIT_SECONDS}s delay between requests)...")

    for i, url in enumerate(urls, 1):
        data = parse_detail_page(url)
        if data:
            results.append(data)
        else:
            failed += 1

        if i % 10 == 0 or i == total:
            log(f"    Progress: {i}/{total} scraped ({len(results)} ok, {failed} failed)")

        if i < total:
            time.sleep(RATE_LIMIT_SECONDS)

    log(f"    [OK] Scraping complete: {len(results)} blood banks extracted, {failed} failed")
    return results


# ─── 6. Step 3: Insert into database ────────────────────────────────

def insert_into_database(records: list[dict]):
    """Insert scraped records into the blood_banks table, skipping duplicates."""
    db_uri = os.getenv("SUPABASE_URI")
    if not db_uri:
        log("\n[WARN] SUPABASE_URI not set. Skipping database insert.")
        log("  Data was saved to JSON file. Set the env var and re-run.")
        return

    # Normalize URI
    if db_uri.startswith("postgres://"):
        db_uri = db_uri.replace("postgres://", "postgresql://", 1)

    engine = create_engine(
        db_uri,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 20, "gssencmode": "disable"},
    )

    # Verify connection
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        log(f"\n[3/3] Connected to database. Inserting {len(records)} records...")
    except Exception as e:
        log(f"\n[WARN] Database connection failed: {e}")
        log("  Data was saved to JSON file. Fix the connection and re-run.")
        return

    insert_query = text("""
        INSERT INTO blood_banks (name, address, phone)
        SELECT :name, :address, :phone
        WHERE NOT EXISTS (
            SELECT 1 FROM blood_banks
            WHERE LOWER(TRIM(name)) = LOWER(TRIM(:name))
        )
    """)

    inserted = 0
    skipped = 0

    with engine.begin() as conn:
        for record in records:
            result = conn.execute(insert_query, {
                "name": record["name"],
                "address": record["address"],
                "phone": record["phone"],
            })
            if result.rowcount > 0:
                inserted += 1
            else:
                skipped += 1

    log(f"    [OK] Database insert complete:")
    log(f"      New records inserted: {inserted}")
    log(f"      Duplicates skipped:   {skipped}")


# ─── 7. Main ────────────────────────────────────────────────────────

def main():
    log("=" * 60)
    log("  ANKUR - West Bengal Blood Bank Scraper")
    log("  Source: myvisitinghours.org")
    log("=" * 60)

    # Step 1: Get all URLs
    urls = fetch_listing_urls()
    if not urls:
        log("[WARN] No blood bank URLs found. Exiting.")
        sys.exit(1)

    # Step 2: Scrape detail pages
    records = scrape_all_detail_pages(urls)
    if not records:
        log("[WARN] No records scraped successfully. Exiting.")
        sys.exit(1)

    # Save to JSON as backup
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
    log(f"\n    [SAVED] Backup saved to: {OUTPUT_JSON}")

    # Print summary table
    log(f"\n{'─' * 80}")
    log(f"  {'#':>3}  {'Name':<45} {'Phone':<20}")
    log(f"{'─' * 80}")
    for i, rec in enumerate(records[:10], 1):
        name_short = rec["name"][:43] + ".." if len(rec["name"]) > 45 else rec["name"]
        phone_short = rec["phone"][:18] + ".." if len(rec["phone"]) > 20 else rec["phone"]
        log(f"  {i:>3}  {name_short:<45} {phone_short:<20}")
    if len(records) > 10:
        log(f"  ... and {len(records) - 10} more")
    log(f"{'─' * 80}")

    # Step 3: Insert into database
    insert_into_database(records)

    log(f"\n[DONE] {len(records)} West Bengal blood banks processed.")


if __name__ == "__main__":
    main()
