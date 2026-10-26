# Registering SkyLedger's sources in Zetaris

Goal: the GeoLinker query in `app/adapters/zetaris.ts` (`geoJoinSql`) runs in Zetaris against three registered sources, and SourceMapper reports them `via zetaris`.

> **Status:** written before Zetaris was installed on this machine. The REST call follows the official troubleshooting guide. The steps for registering file sources (step 3) are **not yet verified**; adjust them to what the Zetaris UI shows and update this file.

## 1. Zetaris running and reachable
- `docker compose ps --all` is healthy and `./verify.sh` shows 9/9.
- The UI at http://localhost:3000 runs `SELECT 1 AS one;`.
- The API reference is at http://localhost:8888/redoc/index.html (not port 8889).

## 2. Export the CSVs
```bash
npm run export:zetaris      # writes data/zetaris/cm_sources.csv, ghgrp_facilities.csv, ghgrp_ch4.csv
```

## 3. Make the files reachable and register them (verify in the UI)
Zetaris can't read files on the laptop directly. Options, in order of preference:
1. Copy `data/zetaris/` into a path mounted into the Zetaris container (check the platform's `docker-compose.yml` for a data volume), then register each CSV as a file source.
2. Upload the CSVs to object storage that Zetaris can reach (for example S3) and register them from there.

Register them so they resolve as the names in `.env`:

| CSV | Table name (`.env`) |
|---|---|
| `cm_sources.csv` | `ZETARIS_PLUMES_TABLE=skyledger.cm_sources` |
| `ghgrp_facilities.csv` | `ZETARIS_FACILITIES_TABLE=skyledger.ghgrp_facilities` |
| `ghgrp_ch4.csv` | `ZETARIS_CH4_TABLE=skyledger.ghgrp_ch4` |

If Zetaris assigns different qualified names, just change those three variables.

Stretch goal: register Carbon Mapper and EPA Envirofacts as **REST sources** (both endpoints need no auth; URLs are in `data/sample/manifest.json`), so the join runs over live APIs.

## 4. Create an API token
Go to **Management → API Tokens** in the UI. Create the token yourself and put it in `.env` as `ZETARIS_API_KEY`. The Oct 22 permissions guide recommends a non-admin user for the agent.

## 5. Test
```bash
# in .env: SAMPLE_MODE=false
npx tsx run.ts --once input_examples/example_2.json --quiet | tail -1
```
Expect `"sql_live": true` in the output, and GeoLinker evidence with `"source": "zetaris"`. If you see `fallback`, the trace's `output_summary` gives the Zetaris error.

From inside Docker, use `ZETARIS_REST_URL=http://host.docker.internal:8888/api/v1.0`.

## Dialect notes
`geoJoinSql` uses `ASIN`, `SQRT`, `POWER`, `SIN`, `COS` and `RADIANS`, a `BETWEEN` bounding box, and a `LEFT JOIN` on a grouped subquery. Run one statement per call. If the Lightning dialect rejects a function, fix it in `geoJoinSql`. The sample engine (`sampleGeoJoin`) reproduces the same semantics in TypeScript.
