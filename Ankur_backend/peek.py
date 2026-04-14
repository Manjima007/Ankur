import requests
import os

api_key = os.getenv("DATA_GOV_API_KEY")
if not api_key:
    raise RuntimeError("DATA_GOV_API_KEY is required")

url = f"https://api.data.gov.in/resource/fced6df9-a360-4e08-8ca0-f283fc74ce15?api-key={api_key}&format=json&limit=1"
print("Triggering Request...")
response = requests.get(url, timeout=30)
response.raise_for_status()
data = response.json()

print("🚨 THE COLUMNS ARE: 🚨")
print(list(data['records'][0].keys()))