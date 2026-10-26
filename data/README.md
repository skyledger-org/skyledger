# Data

`data/sample/` is a small cache of public data for the Permian Basin (TX/NM, lat 30.5–33.5, lon −104.5 to −101). It powers `SAMPLE_MODE` and is the material registered in Zetaris. Regenerate it with `npm run cache` (`scripts/cache_data.ts`); `manifest.json` records when it was fetched and from where.

| File | Source | Licence / terms |
|---|---|---|
| `cm_sources.json` | Carbon Mapper `catalog/sources.geojson` (CH4, published, eps 500 m), trimmed fields plus detection and observation dates parsed from plume and scene names | Carbon Mapper data terms: non-commercial use with attribution |
| `cm_plumes.json`, `images/*.png` | Carbon Mapper `catalog/plumes/annotated` for 60 sources near GHGRP facilities: plume origin, bounds, wind, plume-on-RGB quicklook | as above |
| `ghgrp_facilities_2023.json` | US EPA Envirofacts `PUB_DIM_FACILITY`, TX and NM, RY2023, inside the bounding box | US Government public data |
| `ghgrp_ch4_2023.json` | US EPA Envirofacts `PUB_FACTS_SUBP_GHG_EMISSION`, gas CH4, RY2023, for those facilities (CO2e tonnes by subpart) | US Government public data |
| `ghgrp_subparts.json` | US EPA Envirofacts `PUB_DIM_SUBPART` | US Government public data |
| `edgar_tickers.json` (optional) | SEC `company_tickers.json` (needs `SEC_USER_AGENT`) | US Government public data |

## Facts checked against the data (2026-10-26)

- **RY2023 is the latest GHGRP year on Envirofacts.** `PUB_DIM_FACILITY/STATE/TX/YEAR/2024` returns no rows.
- **Wind convention.** Carbon Mapper's `wind_direction_avg_auto` behaves as the meteorological "from" direction: in 30 of 41 plumes with a measurable offset, the plume extent lies opposite the reported wind direction.
- **Basin-level reports.** GHGRP Subpart W onshore production (`W-ONSH`) and gathering and boosting (`W-GB`) facilities aggregate an operator's equipment across a basin, so their coordinates are not an emitting site. Gas plants (`W-PROC`) and compressor stations (`W-NGTC`) are point facilities. One `W-ONSH` report in the box is 1.6 Mt CO2e.
- **Owner strings are inconsistent.** For example, "TARGA RESOURCES CORP (73%)" and "TARGA RESOURCES (73%)" both appear; so do "PIONEER NATURAL RESOURCES CO" and "PIONEER NATURAL RESOURCES USA INC".
- Newer Tanager plumes often have no per-plume emission rate. SkyLedger uses the Carbon Mapper **source-level** average rate and uncertainty.

- **CH4 GWP for RY2023 is 25 (AR4).** The April 2024 Table A-1 amendments (89 FR 31802) moved CH4 to 28 (AR5) starting with RY2024 reports. Checked in the data too: 314 of 363 published RY2023 CH4 CO2e values divide by 25 to a whole 0.001 t, against 13 of 363 for 28. Configurable via `CH4_GWP`.
