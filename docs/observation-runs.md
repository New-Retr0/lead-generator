# Observation Runs — Pipeline Ground Truth (2026-06-10)

Two live runs were executed and watched end-to-end before the verification overhaul,
to capture exactly which APIs fire, what they return, and where fabricated data enters.

## Run A — auto_dealer, Reedley (the "vendor" ground-truth case)

Command: `pallares-leads -v run --market reedley --category auto_dealer --limit 2 --force-refresh`
Run ID: `2fea451a-ac7c-44a1-b213-b2ef98b98e44` · Log: `data/obs_run_a_auto_dealer.log`

### API call sequence observed

| # | Call | Result |
|---|------|--------|
| 1 | `POST places:searchNearby` | **HTTP 400 INVALID_ARGUMENT** — field mask includes `nextPageToken`, which Nearby Search does not accept |
| 2 | `POST places:searchText` | 200 — 2 dealers (Jaber Motors, Martens Chevrolet) |
| 3 | `POST firecrawl /v1/map` (jabermotorsreedley.com) | 200 |
| 4 | `HEAD jabermotorsreedley.com` (domain verify) | 200 |
| 5 | `POST firecrawl /v1/scrape` formats=json (Tier 1) | 200 |
| 6 | `POST firecrawl /v1/search` (Martens website gap-fill) | 200 |
| 7 | `POST firecrawl /v1/scrape` formats=json on **zoominfo.com** (Tier 2) | 200 |
| 8 | `POST ai-gateway /v1/chat/completions` ×2 (sales copy) | 200 |

### Fabrication evidence (DB after run)

- Jaber Motors `site_contacts` **again** contains `{"label": "General Manager", "name": "John Doe"}` —
  invented by Firecrawl's JSON-extraction LLM; the real contact page lists (559) 517-3877 with **no name**.
  BBB ground truth: principal is **Mr. Ahmad A. Jaber, President**.
- `best_contact_phone` was then swapped to the Google Places phone `(559) 743-7184` while keeping the
  fabricated name/role — a chimera of 3 sources presented as one person.
- Martens Chevrolet Tier 2 scraped **zoominfo.com** (a data broker, not a primary source) and returned
  "Cynthia Tejirian" and "Cindy Terjirian" as *separate* contacts — duplicate-with-typo, classic
  ungrounded LLM noise.

### Cost recording evidence

- `run_events` estimated: map 1 + scrape_json 5 (Jaber), search 1 + search_contact 6 (Martens).
- `cost_events`: **only** ai_gateway rows, both `usd = 0.0`.
  - Firecrawl rows missing → `_credits_from_payload()` reads `payload.metadata` /
    top-level `creditsUsed`, but a direct API probe confirmed credits live at
    **`payload.data.metadata.creditsUsed`** (scrape). `/search` returns **no credit field at all**
    (must be estimated: 2 credits per ≤10 results).
  - Google Places rows missing → `PlacesClient` constructed without `store` in
    `run_market._discover_category`.
  - AI Gateway `usd=0.0` → `pricing.yaml` had no entry for `google/gemini-2.5-flash`.

## Run B — hotel, Reedley (random-site case)

Command: `pallares-leads run --market reedley --category hotel --limit 2`
Log: `data/obs_run_b_hotel.log`

- Same Nearby Search 400 at discovery.
- Edgewater Inn had no Google website → website discovery DNS-guessed `edgewaterinn.com`,
  "verified" it (DNS+HTTP only), then every scrape failed (`SCRAPE_ALL_ENGINES_FAILED`, parked
  `/lander` page). **Domain verification proves a domain exists, not that it belongs to the
  business** — a guessed-website provenance hazard.
- Tier 2 search gap-fill ran; sales copy generated for both hotels.

## Other findings

- Browser Use never invoked in either run: `allow_owner_chain` false for both categories and the
  phone contact-bar was met from Google Places, so the owner-chain gate never opened. Skip reasons
  were not visible in the logs (debug-level only at the time of observation).
- Nearby Search has been silently failing on **every** run (the 400 above), wasting a billed request
  and reducing discovery coverage.
- CLI `-v` is a global flag and must precede the subcommand.

These findings drove the verification gate, per-fact provenance ledger, BBB registry stage,
cost-parsing fixes, and field-mask fix implemented in the overhaul.
