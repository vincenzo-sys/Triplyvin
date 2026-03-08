# Blog Engine Changelog

## 2026-02-26 — External Links Database & Prompt Integration

### What Changed

**New file: `data/external-links.json`**
- Comprehensive database of 71 verified external links (66 active, 10 broken/tracked)
- Every link curl-verified with HTTP status code and real page title
- 18 fields per link: url, domain, title, description, anchorTextSuggestions, category, subcategory, linkType, authority, trustSignals, relevantAirports, relevantTopics, relevantArticleTypes, rel, contextualUsage, pageType, lastVerified, status
- Covers 16 categories: official-airport, government, transit, parking-aggregator, lounge-guide, travel-guide, flight-tracker, luggage-storage, ev-charging, review-platform, rental-car, mapping, family, construction, ground-transportation, security-programs
- Broken links tracked in `_brokenLinks` section with replacement URLs where available
- Usage guidelines for link density, domain diversity, anchor text, placement, and rel attributes

**Airport coverage:**
- JFK: 36 verified links (7 official airport pages, 7 government/.gov, 3 transit, 4 parking aggregators, 2 lounge guides, 4 travel guides, 3 flight trackers, 2 luggage storage, 2 EV charging, 2 review platforms, 1 rental car, 1 mapping, 2 family/tools, 1 construction, 2 rideshare, 2 ground transport)
- LGA: 16 verified LGA-specific links (9 official airport pages, 1 construction, 1 parking aggregator, 1 coupon site, 2 travel guides, 1 rental car, 1 rideshare) + all "all airports" links shared with JFK
- 14 links marked relevant to "all" airports (TSA, CBP, FAA, BTS, MTA fares, CLEAR, FlightAware, Google Flights, Waze, ChargePoint, Mamava, SeatGuru)

**New file: `src/external-links.ts`**
- Loader module with `getExternalLinks(airportCode, articleType)` — filters links by airport and article type
- `formatExternalLinksForPrompt(links, articleType)` — formats filtered links into prompt-ready text grouped by authority level
- Caches the JSON database in memory after first load
- Includes TypeScript interface `ExternalLink` for type safety

**Modified: `src/prompts/write.ts`**
- Imports external links module
- Injects filtered, formatted external links into the write prompt between airport data and topics
- Updated rule #5: changed from generic "external links encouraged" to explicit instruction to use only verified database links with proper rel attributes and anchor text

**Modified: `src/prompts/edit.ts`**
- Imports external links module
- Added `airportCode` parameter to `buildEditPrompt()`
- Added rule 3b: external link validation — verify URLs exist in approved database, replace fabricated URLs, enforce rel="nofollow" where specified, check domain diversity

**Modified: `src/claude.ts`**
- Added `airportCode` parameter to `editArticle()` function signature
- Passes `item.airportCode` through to `buildEditPrompt()` in `generateArticle()`

### Why

Previously, the AI writer was told "external links to authoritative sources are encouraged" but given no verified URLs. This caused:
- Hallucinated/fabricated external URLs
- No control over which domains received link equity (dofollow vs nofollow)
- No anchor text guidance
- Inconsistent external link quality across articles

Now the AI writer receives a curated, verified set of links filtered by airport and article type, with explicit anchor text suggestions, rel attribute guidance, and contextual usage instructions.

### Broken URLs Discovered

During verification, these previously-referenced URLs were found broken:
- `panynj.gov/airports/en/jfk.html` — 404 (replaced with port-authority/en/index.html)
- `panynj.gov/airports/en/lga.html` — 404 (replaced with port-authority/en/index.html)
- `ny.gov/services/e-zpass` — 404 (no replacement)
- `parksleepfly.com/jfk-airport-parking` — 404 (use homepage instead)
- `thepointsguy.com/guide/jfk-airport/` — 404
- `sleepinginairports.net/usa/new-york-jfk.htm` — 404
- `accuweather.com` JFK page — timeout/connection refused
- `spothero.com/airport/nyc/laguardia-parking` — 404 (correct URL: /lga-parking)
- `bestparking.com/laguardia-airport-lga-parking/` — 404
- `chase.com guide-to-laguardia-airport` — 404
