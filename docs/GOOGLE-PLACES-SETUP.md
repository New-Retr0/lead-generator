# Google Places API (New) — API key setup

The lead generator uses **Places API (New)** only (REST v1 at `places.googleapis.com/v1`).
Do **not** enable the legacy "Places API" — that is the old product.

Official docs:

- [Get started with Places API (New)](https://developers.google.com/maps/documentation/places/web-service/get-api-key)
- [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)
- [Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Place Types (Table A)](https://developers.google.com/maps/documentation/places/web-service/place-types)

## Step-by-step

### 1. Google Cloud project + billing

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (e.g. `pallares-leads`) or select an existing one.
3. Attach a **billing account** — Maps Platform requires billing even though Google gives
   [$200/month in free Maps credit](https://developers.google.com/maps/billing-and-pricing).

### 2. Enable Places API (New)

1. Go to [APIs & Services → Library](https://console.cloud.google.com/apis/library).
2. Search for **Places API (New)**.
3. Click **Enable**.

Optional but recommended on the same project:

- **Geocoding API** — only if you add dynamic city geocoding later (this repo ships lat/lng in `config/markets.yaml`).

### 3. Create an API key

1. [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. **Create credentials → API key**.
3. Copy the key into `pallares-lead-generator/.env`:

   ```env
   GOOGLE_PLACES_API_KEY=AIza...
   ```

### 4. Restrict the key (production)

Edit the key → **Application restrictions** (IP or none for local scripts).

**API restrictions** → Restrict key → select only:

- **Places API (New)**

This prevents the key from being used against other Google APIs if it leaks.

### 5. Verify from the project

```powershell
cd "C:\Users\Austi\Documents\Projects\pallares-lead-generator"
.\.venv\Scripts\Activate.ps1
pallares-leads doctor
```

You should see `Places API (New): OK`.

## What this pipeline calls

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/places:searchText` | Keyword discovery ("gas station in Reedley, CA") |
| `POST /v1/places:searchNearby` | Type-based discovery when a category maps to Table A types |

Every request sends:

- Header `X-Goog-Api-Key`
- Header `X-Goog-FieldMask` (explicit fields only — never `*` in production)

### Billing SKUs (field mask matters)

Our discovery field mask requests **Pro + Enterprise** fields:

| Field | SKU tier |
|-------|----------|
| `displayName`, `formattedAddress`, `location`, `types`, `googleMapsUri`, `primaryType` | Pro |
| `nationalPhoneNumber`, `websiteUri`, `businessStatus` | Enterprise |

Phone + website are required for lead export, so runs bill at **Text Search Enterprise** per result page, not the cheaper Essentials tier. That is expected — we minimize cost by:

- Narrow field masks (no photos, reviews, atmosphere fields)
- `regionCode: US` + `locationBias` so results stay in-target cities
- `includedType` where Table A has a match
- Skipping `CLOSED_PERMANENTLY` businesses
- `--discover-only` while tuning queries before Firecrawl enrichment

### Demo key vs production

The Maps docs page offers a **Demo Key** for quick experiments. For PALLARES production runs, use a **restricted key on your own billing project** (steps above). Demo keys have usage limits and are not for automated pipelines.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `403 PERMISSION_DENIED` / API not enabled | Enable **Places API (New)** on the project |
| `400 INVALID_ARGUMENT` on field mask | Check mask syntax — no spaces after commas |
| Results outside Central Valley | Confirm `config/markets.yaml` lat/lng; pipeline sends `locationBias` |
| Empty phone/website columns | Normal for some listings — enrichment falls back to Firecrawl + main phone |
| `REQUEST_DENIED` on key | Key restrictions may block Places API (New) |
