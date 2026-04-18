import requests

url = "https://api.data.gov.in/resource/fced6df9-a360-4e08-8ca0-f283fc74ce15?api-key=579b464db66ec23bdd0000014e8cc9744ff44dfb47f1668a341426e7&format=json&limit=1"
print("Triggering Request...")
response = requests.get(url)
data = response.json()

print("🚨 THE COLUMNS ARE: 🚨")
print(list(data['records'][0].keys()))