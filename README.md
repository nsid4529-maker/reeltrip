# ReelTrip

Turn saved travel reels into places you can review, organise and use to plan a trip.

**Status: working prototype, not a validated business or a production-scale booking service.** Built by Siddarth Nair with coding agents. [What I decided, and what agents built](docs/AGENT-COLLABORATION.md).

[Try the web prototype](https://reeltrip-travel-studio.earthylark68.chatgpt.site/) · [Architecture](docs/ARCHITECTURE.md) · [Limitations and evidence](docs/VALIDATION.md)

## Walkthrough

![Verified ReelTrip interface snapshots](docs/media/reeltrip.gif)

This GIF cycles through actual interface captures from the 24 November 2026 checks. It is a snapshot walkthrough, not a continuous recording or a processing-speed demonstration. Source credits and Google attribution remain visible.

## What it does

- Saves public Instagram/TikTok links into a library, topic bundles or shared trip buckets.
- Analyses sampled video frames, speech and captions to identify places and practical details, with source evidence and timestamps.
- Matches places through Google Places, plots sufficiently confident matches, and lets people correct uncertain matches.
- Supports Keep/Skip votes, dates and a draft itinerary based on the group's choices.
- Opens provider booking/search pages. It does not claim that a link is a confirmed reservation or that unconfigured integrations return live availability.

The iOS companion includes a share extension. Its latest Instagram share screen was confirmed working by me on a physical iPhone; this is not an App Store release or a completed native acceptance suite.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/`, `components/` | React interface and server routes |
| `lib/server/` | Validation, shared trips, quotas, processing gateway and venue resolution |
| `db/` | Database schema and migrations |
| `extraction-worker/` | Python acquisition, audio/frame processing, evidence validation and bounded job queue |
| `tests/` | Web regression tests |
| `ios/` | Native app, share extension and core tests |
| `docs/` | Design decisions, architecture and measured limitations |

## Local development

Requires Node 22.13+ and npm. This is a Vinext/React application with Cloudflare bindings, not a static HTML site.

```sh
npm ci
npm run dev
```

The local Vite configuration supplies development Cloudflare bindings. The public snapshot has no production Sites project ID. Create your own deployment and database; never point a clone at the author's production infrastructure. Hosted processing and live maps require your own server configuration and API access. Without these, the UI is inspectable but new-video analysis and live venue matching will not work.

```sh
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
cd extraction-worker
python3 -m unittest discover -s service/tests -v
```

Worker tests mock external services; HTTP integration tests need a loopback socket. For worker deployment, required secrets, media limits and failure handling, see [the worker guide](extraction-worker/service/README.md). Keep all credentials in server environment variables. API use can incur charges.

## Current boundaries

Personal bundles hold 12 reels; a device library holds 100; a shared bucket permits 50. These are configured limits, not load-test results. Platform acquisition can fail, visual sampling can miss details, and venue matches need review. Guest device-local data has no cross-device account sync. The planned real-group study has not happened.

This public snapshot excludes private development history, credentials and internal working notes. Third-party libraries and source-platform content retain their respective rights; public visibility alone does not grant a licence to reuse creator media.
