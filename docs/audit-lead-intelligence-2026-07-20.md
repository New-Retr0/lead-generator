# PALLARES Lead Generator — Audit & "Best in the World" Blueprint
*Produced 2026-07-20.*

## Implementation status (branch `feat/lead-quality-phase0-1`)

Phase 0 and the Phase 1 dud gate are **built and tested** (214 tests pass; new code ruff-clean). Shipped:
- Places field-mask trim → **Enterprise SKU $0.035** (verified against Google's pricing table), pricing.yaml + dashboard + guard test.
- **Association grounding** (name/phone must co-occur), **local area-code** franchise gate, `pureServiceAreaBusiness` discovery filter.
- **OSM discovery removed** (parking categories + `overpass.py`; road-corridor kept + flagged), dead `min_export_score` removed.
- **Dud gate**: migration (`dud_reason`/`dud_at`), `mark_dud()`, the null-`last_enriched_at` re-admission **leak fixed**, discovery-admission (Phase A) + terminal-unreachable (Phase B) wiring, dashboard excludes duds + a **Duds** inspection tab.
- **Export provenance**: `verification`/`evidence_url`/`evidence_quote` columns in the sales CSV.
- **Owner-graph** views (`owner_portfolio_v1`, `lead_owner_portfolio_v1`) + `get_owner_portfolio()`.
- **Compliance fetch-host guard**: LoopNet/CoStar/Crexi/Showcase are never fetched (ToS/CFAA), enforced at every Firecrawl fetch chokepoint; broker-own-domain PDFs still work.

**Migrations applied** to the live `pallares-leads` DB on 2026-07-20 (dud columns + owner-graph views), recorded in `schema_migrations`.

**Deliberately cut (owner decision, 2026-07-20):** external DM-sourcing data sources — county parcel/assessor GIS, state business registries (incl. free CA SOS API), Regrid, FDD franchise filings. Rationale: owner names statutorily stripped from most CA county layers, redistribution prohibited/ambiguous per-county, per-state repetition = high effort + legal risk for low value. The product verifies/enriches contacts only via company websites, Google, BBB, and LinkedIn (SERP-only). See memory `rejected-external-data-sources`.

**Deferred (needs a live-credit A/B):** Tier-2 double-fetch collapse (documented in-code). **Out of model (cut):** paid reachability (Twilio/email verifiers), Gmail outreach, DNC-scrub (cold-calling B2B). Everything below is the original full blueprint for reference.

## How this was produced

- **3 code-exploration passes** mapped the pipeline, every external integration, and every lead-quality gate against the actual source.
- **A 9-expert panel** (Firecrawl, Google Places economics, public-records/property intelligence, contact validation & deliverability, search-operator/OSINT, competitive intelligence, codebase architecture, Workspace/Firecrawl automation, legality) each researched public docs + the repo and produced structured proposals — **58 proposals total**.
- **25 cross-scrutiny critiques** red-teamed every proposal from three adversarial lenses (legality, cost-and-real-yield, code-reality). Ideas that were theater, illegal, or already-built were killed or rewritten.
- **A synthesis + reconciliation pass** fused the survivors into one ranked blueprint.
- **Adversarial verification** re-fetched the cited URLs behind the 11 highest-impact claims; a **completeness critic** hunted for what the panel itself missed.

**Honesty notes.** 52 agents ran; 3 errored mid-run and were covered by their peers (2 critique lenses, 1 synthesis lens — the reconciler still produced a full blueprint). The subagents executed on Claude Opus 4.8 (the workflow default), not Fable. Of the 11 verified claims, **1 was contradicted, 4 confirmed, 6 unverified-at-cited-URL** (directionally right but the load-bearing figures live on a linked pricing page or a JS-rendered terms page). All caveats are surfaced inline — nothing was rounded up.

---

## The verdict: what "best in the world" means, and why PALLARES can win

"Best" is **not** a database-size contest — ZoomInfo and Apollo already won that, and their data is a warehouse of rows with unknown provenance and unknown freshness. Best means **four claims you can prove on every single lead**:

1. **Realness** — every fact carries a `source_url` + a verbatim quote from the page it came from.
2. **Reachability** — the phone actually connects and the email actually delivers, verified, not assumed.
3. **Decision-maker resolution** — a *named human* who can say yes, sourced from records with real provenance.
4. **Falling cost per closeable lead** — metered per stage, with dead weight removed before a credit is spent.

Because the business earns a 10% commission only on **closed** deals, the entire system should optimize one number: **the percentage of exported leads that carry a verified named decision-maker AND a validated callable *local* phone, at a falling cost per such lead.** Not volume.

PALLARES already owns the hardest of the four claims. The path to "most advanced in history" is to finish the other three in a deliberate sequence, treating legality as a hard gate rather than a feature.

---

## What already makes it the best (the moat)

These are real, in the code today, and structurally hard for incumbents to copy:

1. **Verbatim grounding gate on every extracted fact** (`enrich/verify.py`). A name/phone/email is kept only if it literally appears in the fetched page text — otherwise it's stripped. ZoomInfo/Apollo/Clay/CoStar cannot make this claim because they have no page and no quote.
2. **A single machine-checkable "verified decision-maker" contract** (`is_verified_decision_maker` in the `partner_leads_v1` SQL view) that is the north-star metric expressed as code, reused identically by the pipeline, the dashboard, and the Partner API. One auditable definition of "good."
3. **Live single-pass discover+enrich** — every grounded phone was on the page *today*. Freshness by construction; the structural reason a stale warehouse cannot claim reachability.
4. **Per-lead, per-stage cost metering** (`record_cost_event`) — the cost claim is *provable*, and the ledger can drive an expected-value gate that auto-disables tiers that yield no decision-makers.
5. **Physical-property verticalization** — grid-tiled discovery of strip malls, QSR pads, gas stations, and parking lots that no B2B contact database targets.
6. **An owner-graph substrate that's ~80% built** (`owner_name_normalized` is already indexed) — the raw material to turn one owner into a multi-site portfolio deal.
7. **Firecrawl-as-licensed-intermediary + public-records-first sourcing** — a clean-hands legal posture raw-scraper incumbents can't claim. (Firecrawl's paid plan includes commercial use per its published materials — see the Firecrawl commercial-use section below.)
8. **A verification ledger** (`lead_facts`: fact + source + quote + verification) that already emits the exact raw material for a per-lead evidence dossier.

---

## Firecrawl commercial-use posture — resolved (paid plan = authorization)

*Note: an earlier draft flagged this as a critical blocker. That was based on the panel's verifier reading the Terms of Service in isolation. It has been re-verified and downgraded — see below.*

The "licensed intermediary" legal posture rests on a paid Firecrawl plan authorizing commercial use. **Firecrawl's own published materials confirm it:** paid subscriptions "explicitly permit building SaaS products, integrating search into commercial applications, selling products using search functionality, offering services powered by the API," and "commercial licensing gets built into paid plans without separate licensing fees for standard use cases" ([Firecrawl glossary](https://www.firecrawl.dev/glossary/web-search-apis/use-web-search-api-commercial-products)).

The apparent conflict with the Terms of Service — which bars commercial use "except as expressly authorized by Firecrawl" — dissolves on a combined reading: **the paid plan *is* that express authorization.** The two documents agree.

**Residual housekeeping (not a blocker):** the crisp "paid plans permit commercial use" language sits on a Firecrawl glossary/marketing page, while the binding ToS uses the "except as expressly authorized" phrasing. Keep a dated copy of the glossary + pricing statements on file, and (belt-and-suspenders only, if you ever want it airtight for a partner contract) a one-line email confirmation. Separately, confirm Firecrawl's robots.txt behavior from its docs rather than the ToS, since the ToS doesn't restate it. None of this gates shipping.

---

## The 17 ranked recommendations

Ranked by lift to the verified-DM-with-callable-local-phone rate, then cost, then effort. Legality: 🟢 green / 🟡 needs mitigation.

| # | Recommendation | Theme | DM lift | Cost | Effort | Legal |
|---|---|---|---|---|---|---|
| 1 | **Association (DOM-block) grounding** — a phone/email counts only if it co-occurs with its named DM in the *same* DOM block | realness | High | +0 cr | M | 🟢 |
| 2 | **Enforce the LOCAL half** — NANP area-code table + franchise trusted-phone NPA check *before* `skip_firecrawl` | callable-local | High | $0 | S | 🟢 |
| 3 | **Free email deliverability** — syntax + DNS MX + disposable-domain + role-account flag | reachability | Med-High | $0 | M | 🟢 |
| 4 | **Dud-persist migration + `mark_dud()`** + fix the null-`last_enriched_at` re-admission leak | cost substrate | High | ~$0 | M | 🟢 |
| 5 | **Dud gate** (`resolve/dud_gate.py`) — cancel paid enrichment on out-of-green leads | cost / directive #2 | High | saves | M | 🟢 |
| 6 | **CLOSED_TEMPORARILY soft-dud + `pureServiceAreaBusiness` hard-filter** at discovery | realness | Med | $0 | S | 🟢 |
| 7 | **Remove OSM at source**; replace with open-licensed county ArcGIS REST (geometry/address; owner-name where licensed) | legality + quality | Med | saves | M | 🟡 |
| 8 | **Trim the Places field mask** to Enterprise tier + link `pricing.yaml` to the mask with a test | cost / directive #1 | None | −12.5% | S | 🟢 |
| 9 | **PM "our team" dork class** + generic dork runner (documented `pdf` category + `includeDomains`) | new DM source | High (PM) | ~$0.0025 | M | 🟢 |
| 10 | **CA SOS Business Search API** — FTB-suspended kill-gate + free registered-agent name (retire the bizfile scrape) | legality + DM | Med | free | M | 🟢 |
| 11 | **Cross-county owner graph SQL view** — one owner → N parcels → portfolio deal | deal-value | High $ | $0 | S | 🟢 |
| 12 | **Collapse the Tier-2 double-fetch** — run JSON extraction inside the search's `scrape_options`; cut `limit` 6→3 | cost | None | −~5 cr | M | 🟢 |
| 13 | **Cheap paid reachability at export** — Twilio Lookup v2 line-type (drop non-fixed-VoIP burners) + paid email verifier | reachability | Med-High | +$0.008/ph | M | 🟢 |
| 14 | **Fix the delivery provenance leak** — put `source_url`+quote+verification in the CSV/Sheet + a per-lead Evidence dossier Doc | product | Med | ~$0 | S | 🟢 |
| 15 | **Compliance backbone** — host-level fetch denylist + robots invariant + CCPA suppression store + Firecrawl authorization record | legality | None | $0 | M | 🟢 |
| 16 | **FDD Item 20 franchisee ingestion** for QSR/gas brands (government portals only) | franchise DM | High (fr.) | $0 src | L | 🟢 |
| 17 | **EV-gate the cost ledger; delete dead code; deferred quarterly freshness; Gmail draft-only outreach** | discipline | None | saves | M | 🟢 |

### Why the top 5 matter (the load-bearing detail)

**#1 — Association grounding (the single most important fix).** Today `ground_phone` matches the *whole* squashed page: any 10 digits appearing anywhere ground *any* contact. That means a "verified decision-maker" can be shipped carrying a neighboring tenant's phone number. The fix: add the free `html` format to the scrape you already pay 5 credits for, and require the grounded name and grounded phone/email to sit in the *same DOM block* — not a flat 250-char window on squashed markdown (which false-drops two-column tables and false-accepts footers). Ship it as a confidence *downgrade* (unpaired → "corroborated," not deleted) and instrument the yield delta before hard-gating. This is also a CCPA data-accuracy and wrong-party-TCPA fix. **Cost: +0 credits.** Do not persist raw HTML to cache — use it transiently.

**#2 — Enforce "local."** The metric requires a *local* callable phone, but `is_local_callable_phone` only checks callable-and-not-toll-free — zero area-code logic. Worse, franchise categories (gas/QSR/grocery/pharmacy/bank) trust the Google phone and set `skip_firecrawl`, so a brand call-center number ships as the "callable DM." A static NANP area-code→region table (whitelist 559/209/661/916/530/408 for the Central Valley, plus the expansion-state NPAs) run on the trusted Google phone *before* the skip short-circuit catches both, at **$0**. Soft-downgrade non-local (an out-of-area corporate DM can still be valid), don't hard-kill.

**#3 — Free email deliverability.** No MX/disposable/role check exists anywhere today. Add `dnspython` MX resolution (not the current A-record check), a disposable-domain blocklist, and role-account flagging (`info@`/`sales@` → lower DM-confidence, not deleted). Removes provably-undeliverable emails before any paid verifier runs. Honest limit: this can't confirm an individual mailbox or a catch-all — that's the export-tier paid verifier (#13).

**#4 — Dud persistence + the leak fix (the substrate everything else needs).** A confirmed live bug: `should_skip` (`store.py:191`) and `filter_new_leads` (`store.py:249`) both short-circuit on `if row is None or not row['last_enriched_at']` — so a discovery-time dud (never enriched, null timestamp) is **re-admitted and re-processed every single run.** Add `dud_reason`/`dud_at` columns (additive migration), a `store.mark_dud()`, and gate on `_row_is_dud()` *before* the timestamp short-circuit. This converts recurring per-dud spend into a one-time cost and doubles as the CCPA suppression substrate.

**#5 — The dud gate (owner directive #2, realized).** A `resolve/dud_gate.py` `is_dud(candidate, phase)` evaluated at discovery admission (Phase A) and between expensive tiers (Phase B). Hard-red reasons: business closed, phone missing/placeholder/toll-free-only/non-local, email no-MX/disposable, out-of-geo, dead-website-and-no-phone, grounding-storm trip. On a dud verdict it early-returns a dud-stamped lead and calls `mark_dud` — cancelling all remaining paid tiers (reuse the existing `should_stop_expensive_stages()` trip). This is exactly what you asked for: **cancel not-green searches, store the bad ones once with a reason, never scrape them twice, and show only good leads by default.**

---

## The 5-phase roadmap

**Phase 0 — Free green movers (ship this sprint).** #1 association grounding (as a downgrade + instrumentation), #2 local-phone NPA check, #3 free email stack, #6 closed/service-area gate, #8 mask trim, #7-part-1 delete OSM discovery, delete the dead `min_export_score`. **Plus the single most important non-code task: measure the realized dud fraction and grounded-local-DM hit-rate from the current `leads` table**, so every later savings/yield number is sized on real data instead of credit arithmetic. → *Outcome: a higher % of exports meet the bar at $0 added cost; franchise call-center numbers and mispaired contacts stop shipping; the metric becomes measurable.*

**Phase 1 — Dud-gate system (owner directive #2).** #4 migration + `mark_dud` + leak fix, #5 the gate, dashboard defaults to excluding duds + a Duds tab showing the reason (replaces the `/duds` redirect stub), #12 Tier-2 collapse. → *Outcome: out-of-green leads never spend credits, are stored once with a reason, are never re-scraped; falling cost per closeable lead becomes literally true; the dashboard shows only closeable inventory.*

**Phase 2 — New grounded DM sources.** #9 PM "our team" dork class, #10 CA SOS API kill-gate + registered agent, #7-part-2 parcel ArcGIS REST replacement, #11 cross-county owner graph. → *Outcome: named, source-backed decision-makers for property managers, multi-site owners, and franchise entities Google Places never returns.*

**Phase 3 — Cheap paid reachability + provenance delivery.** #13 Twilio line-type + paid email verifier at export only, #14 fix the CSV/Sheet provenance leak + per-lead Evidence dossier Doc. → *Outcome: "phone connects / email delivers" becomes a verified, dated attribute; the realness moat becomes the deliverable that closes the deal.*

**Phase 4 — Compliance backbone, franchise depth, EV discipline, deferred freshness.** #15 host denylist + robots invariant + CCPA suppression + Firecrawl authorization doc, #16 FDD Item 20 ingestion, #17 EV-gate + quarterly change-tracking (git-diff, ~1 cr) + Gmail draft-only. → *Outcome: audit-ready and legally durable; franchise-segment coverage lands; EV-negative spend auto-pruned.*

---

## OpenStreetMap verdict: **remove it**

You were right. OSM is used in production in three places: Overpass parking-lot discovery for `parking_small` + `parking_large_private` (the latter is in the *default* `central_valley` campaign), public Nominatim reverse-geocoding, and Overpass road-corridor geometry for NL requests. **OSM leads are duds by construction** — name = "Parking lot (N m²)", address = "Near {city}", no phone, no website — so they dilute the numerator and burn the enrichment ladder. On top of that, Nominatim's usage policy discourages systematic querying and ODbL's share-alike raises a derivative-database question for a proprietary, resold lead DB.

**Disposition:** delete the two Overpass categories and the corridor fetch now; mark any already-stored OSM rows as duds so they're never re-scraped; replace parking geometry/address with **open-licensed county ArcGIS REST** endpoints — which additionally return the **parcel owner name** where the county licenses it, turning the weakest lead class into a named-owner lead. 🟡 Mitigation: gate owner-name export per county (some CA counties withhold owner names by statute), record each county's license URL, and never point an automated adapter at ParcelQuest (its terms bar automated/commercial use).

---

## Kill list (stop doing / never start)

- **OSM/Overpass/Nominatim** — see above.
- **Google Address Validation API** 🔴 — its policy caps address-response storage at ~30 days and conditions caching on end-user consent; incompatible with long-term storage/resale for a third-party business with no consenting user. Also orthogonal to a *phone* north-star.
- **USPS Addresses API** 🔴 — terms bar using the data to build an address list/database for distribution — exactly this business model. *(Verified on USPS's canonical terms page.)*
- **Regrid paid parcel API as framed** 🔴 — standard parcel licenses authorize internal use, not onward resale of owner name+address to partners. Revive only with written redistribution authorization.
- **Automated ParcelQuest adapter** (`owner_chain.py:144`) 🔴 — cut now; live ToS breach.
- **Firecrawl-agent scrape of `bizfileonline.sos.ca.gov`** (`owner_chain.py:136`) 🔴 — replace with the sanctioned CA SOS Business Search API (#10).
- **Dorking/scraping LoopNet/CoStar/Crexi/CBRE HTML or their PDFs** 🔴 — ToS + Cloudflare 403 (CFAA exposure); their offering memoranda usually name a metro investment broker (wrong DM anyway). SERP-reference URLs only, enforced by the host denylist.
- **Automated cold-email *sending* at scale via Gmail API** 🔴 — Google AUP + CAN-SPAM + ~2k/day cap + domain-suspension risk. Draft-only; bulk belongs on a reputation-isolated ESP.
- **Self-hosted SMTP mailbox probing** — reputation hazard; catch-alls make it meaningless. Delegate to a distributed verifier.
- **Google Programmable Search Engine** — snippets only (can't feed the grounding gate), closed to new signups. Firecrawl `/search` is the sole search intermediary.
- **Two-pass "defer phone/website to Place Details"** — *raises* cost ($0.017–0.020/place vs ~$0.0035 batch-amortized). Keep phone/website in the batched Text/Nearby response. (The real Places cost sink is grid-tile over-fetch, not the field mask.)
- **`min_export_score` setting** — dead code, zero consumers; the real gate is hardcoded `lead_score >= 25` in `partner_leads_v1`. Delete it and document the SQL view as the single gate.
- **`search_news()`** — dead, no callers; defer to a future new-store-opening intent signal.

---

## Cost model (honest)

**Current, per exported lead (Central Valley).** Discovery: Places at the Enterprise+Atmosphere SKU, amortized to ~$0.004–0.008/exported lead. Enrichment (Firecrawl ~$0.00083/credit): website-resolve ~1–2 cr; Tier-1 `scrape_json` 5 cr (~$0.004); **Tier-2 double-fetch ~15–20 cr** (~$0.0125–0.017) because it scrapes markdown for up to 2 queries × limit 6, then re-scrapes the top 3 at 5 cr each; capped agent ~15 cr. A lead traversing the ladder ≈ **$0.025–0.045 all-in** — and duds incur most of this and are **re-scraped every run** because of the `store.py` re-admission leak. The ledger also over-reports discovery ~12.5% because `pricing.yaml` hardcodes 0.040 unlinked to the mask.

**Proposed.** Mask trim −12.5% discovery; Tier-2 collapse saves ~5 cr/tier-2 lead; the dud gate pays a dud *at most once* (and OSM duds cost $0, removed at source); brand-host scrape-once collapses duplicate franchise hits; paid reachability added *only* at export on survivors (+$0.008/phone, +$0.001–0.004/email) — trivial against a 10% commission on a commercial contract. **Net: cost per *discovered* lead falls modestly; cost per *closeable* lead falls much more**, because the denominator sheds duds before spend and the EV gate prunes tiers that yield no DMs.

> **Headline savings numbers are placeholders until the Phase 0 measurement runs.** Do not ship a savings claim sized on credit arithmetic alone.

---

## Verification scorecard (what held up under re-checking)

| Claim | Verdict | Note |
|---|---|---|
| Firecrawl paid plan authorizes commercial use | **✅ Confirmed** (corrected) | Firecrawl's published materials: paid plans "explicitly permit building SaaS products... selling products using search functionality." The ToS "except as expressly authorized" clause is satisfied by the paid plan. Earlier "contradicted" verdict came from reading the ToS alone; superseded. |
| USPS terms bar building an address list for distribution | **✅ Confirmed** | Fact holds; cited URL was dead — canonical: `developers.usps.com/terms-and-conditions`. |
| Firecrawl change-tracking git-diff ≈ free vs JSON mode 5 cr | **✅ Confirmed** | "git-diff has no additional cost"; use git-diff for freshness. |
| CCPA B2B exemption expired end-2022 → business contacts in scope | **✅ Confirmed** | Verbatim on the CA AG page. |
| Firecrawl scrape returns free `html` alongside markdown/json | **✅ Confirmed** (part) | But "JSON extraction runs inside `/search` scrapeOptions" was **not** found — validate empirically before relying on the single-fetch Tier-2. |
| Places field→SKU mapping and $40/$35 per-1k figures | **🟡 Unverified at URL** | SKU tier *names* confirmed; the field-to-tier mapping and dollar figures live on the linked pricing list — verify there. |
| Twilio line_type_intelligence $0.008/lookup | **✅ Confirmed** (part) | Price confirmed; the "HLR, mobile-only Line Status" characterization was not on the page. |
| Google Address Validation 30-day storage + consent | **🟡 Unverified at URL** | Real terms, but they live in the Maps Platform Terms, not the cited policies page. |
| CA SOS bizfile ToS (robot ban) / CA `GOV 6254.21` / MN CARDS | **🟡 Unverified** | Pages are JS apps or 403ّd to the fetcher; directionally cited but confirm in a browser. Note: `GOV 6254.21` is about elected-official home addresses — cite the correct parcel-withholding statute per county. |

The pattern: the *directional* conclusions are sound, but several precise figures and clauses need a browser check at the correct URL before they go into a contract or a marketing claim.

---

## What the panel itself flagged as still missing (the next frontier)

The completeness critic surfaced 14 gaps beyond the 17 recommendations. The highest-value ones:

1. **No closed-loop outcome ingestion.** `sales_feedback` (reached_dm / deal_value / won-lost) exists but *nothing writes to it from partners.* You're optimizing a proxy (grounded-DM yield) forever and can never compute true cost-per-closed-deal. **A Google Form / Gmail-reply parser / Partner-API write-back is the cheapest fix and the biggest untouched north-star lever.**
2. **An intent/trigger layer that re-ranks the export queue — with code-enforcement citations as the strongest single member, not the only one.** This is an *additive prioritization signal on top of* the core verified-DM pipeline, never a replacement for discovery. Members of the layer: municipal code-enforcement / nuisance-abatement citations (dirty sidewalk, graffiti, trash-enclosure violations — a business *legally compelled to clean now*, the highest-value member for this vertical), new business-license issuance, new-lease / store-opening signals, and permit filings. A verified DM that also carries a fresh violation is worth many times a cold one, so the queue sorts by intent — but most leads won't have a trigger, and they still ship on the core criteria. Completely untapped today (and `search_news()` was killed with nothing replacing it).
3. **Cross-source entity resolution (fuzzy name+phone+address merge).** Dedupe is only geohash/place_id/fingerprint. Corroboration — "the phone on the business's own site *matches* Google and Yelp" — is a stronger, cheaper realness proof than single-page DOM pairing, and it's the multi-source claim ZoomInfo fakes.
4. **Association member directories already declared in `config/sources.yaml`** (IREM San Joaquin Valley, BOMA Fresno, NARPM) get **zero rank** — they publish PM name + title + direct phone + email in one grounded page. The blueprint built recs around weaker sources while a configured strong one sits unused.
5. **DBA/FBN + city business-license + CA ABC + county health-permit lookups** (several already in `config/sources.yaml`). The SOS API only returns registered *entities* — but a huge share of strip-mall restaurants and QSRs are sole-props/DBAs with no entity. These government records name the human owner and give the store line for exactly the small-operator core of the list.
6. **DNC/TCPA output-side compliance on the delivered call lists.** The compliance backbone covers *scraping* legality but is silent that the *product itself* is a cold-call target list. B2B TCPA exemptions evaporate the moment a number is a cell or an autodialer is used; FL/OK mini-TCPA statutes carry per-call damages. #13's Twilio line-type already fetches the mobile flag — use it for a DNC/cell gate too.
7. **No PII-governance backbone** (access control, encryption-at-rest, retention, breach readiness). The product *is* a database of named humans with phones/emails/addresses; a breach is a CCPA statutory-damages event ($100–$750/consumer).
8. **No ground-truth golden set** to measure the DM-precision and connect-rate the whole "provable" claim rests on. You cannot claim a precision you never measured.
9. **No deal-size/value estimate** to rank the export queue under a 10% model — a 40k-sqft lot is worth an order of magnitude more than a small café at the same acquisition cost; parcel geometry already gives a cheap size proxy.
10. **No lead-exclusivity/assignment control** — delivering the same business to two competing vendors blows both deals.
11. **Inbound Gmail bounce/reply processing** — a hard bounce from a human-sent email is free, provable undeliverability that should flow straight into the dud store; you asked about Gmail automation and this return channel (where the truth lives) is unbuilt.
12. **Deeper Firecrawl capabilities you asked about** — browser *actions* (click/scroll/load-more) for JS-rendered store locators and PM property lists, geo-targeted search for local SERPs, and the `/map` endpoint to enumerate a PM's entire portfolio in one call (feeds the owner graph directly).

---

## Unresolved conflicts (owner decisions)

- **Dud-gate savings magnitude** — after OSM is removed at source and given `scrape_json` is already guarded by `if work_raw.website`, the *incremental* one-time saving per non-OSM residual dud is only ~1–8 cr; the real win is never-re-scraping. Size it from Phase 0 measurement, don't headline a number first.
- **Association-grounding method** — whether the free `html` add is required (moat lens: yes, DOM-block co-occurrence is the only principled pairing) or whether proximity can run on the page text already paid for (cost lens). Both agree a naive flat 250-char window moves the metric the *wrong* way. Needs an A/B on real Central Valley pages before hard-gating.
- **County parcel owner-name legality is per-county and unverified** — ship parcel REST as geometry/address-only until each county's license (free *and* redistribution-permitted *and* owner-field-exposed) is confirmed in writing.
- **FDD Item 20 effort vs value** — high DM value for franchises but effort L and data up to a year stale; sequence against measured franchise-segment yield.
- **Places redistribution (not storage)** — you've waived storage gating, but delivering Places-sourced phone/address to partners off any Google map is a distinct *resale* question; the legality lens recommends re-grounding the delivered phone from the business's own site so the partner-facing field is independently sourced.

---

## Recommended immediate next steps

1. **Run the Phase 0 measurement** — realized dud fraction + grounded-local-DM hit-rate from the current `leads` table — so every downstream number is real.
2. **Ship Phase 0** (association grounding as a downgrade, local-NPA check, free email stack, mask trim, delete OSM discovery, delete `min_export_score`).
3. **Build the dud gate (Phase 1)** — your explicit directive — on top of the migration + leak fix.
4. **Then decide** on the Phase 2 DM-source order using the completeness gaps above (association directories and code-enforcement intent are arguably higher-leverage than some ranked items).
5. **Housekeeping:** keep a dated copy of Firecrawl's commercial-use statement on file (resolved above — no action gates shipping).
