# Hosted ReelTrip video processor

Updated 2026-11-17. This service receives public Instagram/TikTok links from ReelTrip's web gateway. The server downloads and verifies media, samples timestamped frames with ffmpeg, transcribes audio, and requests a structured travel breakdown. Travellers need only the app or browser; no Python, keys, or local tools are required on their phones.

## Deployment

Use `extraction-worker` as the Docker build context and Railway service root directory. The root `Dockerfile` and `railway.toml` start `python -m service.bootstrap`. Attach one persistent Railway volume at `/data`; keep **one service replica**. The queue is SQLite on that volume, with two processing subprocesses inside the same service. Do not run multiple HTTP server processes against this database: startup deliberately marks interrupted jobs as failed.

Required Railway service secrets:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Owner's OpenAI project key with funded API access. |
| `REELTRIP_PROCESSOR_TOKEN` | Random shared bearer token, at least 32 characters. Set the matching secret in the web gateway. Never send it to a browser or native app. |

Optional settings: `REELTRIP_ANALYSIS_MODEL` defaults to `gpt-4.1-mini`; `REELTRIP_WORKERS` defaults to 2 and is clamped to 1–2; `REELTRIP_PENDING_LIMIT` defaults to 20; `REELTRIP_DAILY_LIMIT` defaults to 25 accepted new jobs per UTC day. `REELTRIP_DATA_DIR` defaults to `/data`. Railway provides `PORT`.

Railway mounts volumes as root ([Railway volume documentation](https://docs.railway.com/volumes)). The bootstrap changes ownership of its directory/database and permanently switches to the `reeltrip` user (UID 10001) before starting the HTTP server, ffmpeg, or network calls. Leave the supplied bootstrap start command intact. There is no requirement to run media processing as root.

Generate an HTTPS service domain and configure its origin and matching bearer secret in the server-side ReelTrip gateway. The service has no browser CORS access. User authentication, guest rate limits, provider credentials, and public result sanitisation belong in that gateway.

`GET /health` always returns HTTP 200 for a running service, with `ok:true` and `ready:false` until the token, OpenAI key, curl, ffmpeg and ffprobe are configured. Readiness checks configuration presence; it does **not** make a paid request or verify billing/model access. `POST /v1/jobs` rejects work while not ready. The separate `tiktok` field reports the selected provider and whether its configuration is present.

### Optional authenticated TikTok provider (2026-11-19)

The default `REELTRIP_TIKTOK_PROVIDER=tikwm` retains the existing public resolver. To explicitly select the [Apify Clockworks TikTok Video Scraper](https://apify.com/clockworks/tiktok-video-scraper), set `REELTRIP_TIKTOK_PROVIDER=apify` and supply `APIFY_API_TOKEN` as a Railway **server secret**. The account needs access to that actor and sufficient usage credit. Apify is a third-party service; this configuration does not claim TikTok partnership or guaranteed access to every public video. Never put its key in the site, share extension, or a URL.

The worker submits one full public video URL, disables related-video crawling, requests one result and its MP4, and disables cover, slideshow and subtitle downloads. Each actor run has a fixed 45-second timeout, a `$0.01` maximum total charge setting, and automatic restart disabled. The worker does not retry a run-creation POST; a lost response could already represent a charged run. Acquisition has a 70-second allowance with a bounded three-second best-effort cancellation for an unfinished run. Existing daily job quotas, 50 MB/180-second media limits and the whole-job 360-second deadline remain in effect. Storage/account charges can be separate from an actor's charge cap; configure account spending and retention controls as appropriate.

Use a restricted token with read/run/list/manage-runs permissions for this actor, permission to create new storage (its downloader creates a separate request queue), and access to default run storages. Full-permission actors need not be enabled. Track the token expiry and rotate it in Railway before it expires.

Only the requested video ID and an MP4 in that run's own key-value store are accepted. Authenticated API redirects are rejected. A refusal, quota error, timeout or invalid result fails the request without switching providers or using browser cookies. The existing allowlisted resolver still expands TikTok short links before acquisition.

If Apify is selected without a valid token, `/health` reports `tiktok:{"provider":"apify","configured":false}` and TikTok job submissions return 503 before consuming job quota. Instagram and file uploads retain their independent readiness. `configured:true` confirms presence only; activation still requires an owner-authorised live video test to verify provider output, download, audio and visual analysis.

## API contract

All `/v1/*` requests require `Authorization: Bearer <server secret>`.

- `POST /v1/jobs`, JSON `{"url":"https://www.instagram.com/reel/POST_ID/"}`: HTTP 202 with a queued job; HTTP 200 for a cached completed job.
- `GET /v1/jobs/{UUID}`: HTTP 200 with the current job. Poll around every 3 seconds; a processing attempt has a 360-second deadline.
- Job shape: `{"id":"UUID","status":"queued|processing|complete|failed","stage":"...","result":{...},"error":{...}}`. `result` and `error` are present only when applicable.
- Stages: `queued`, `acquiring`, `sampling`, `transcribing`, `analysing`, `complete`, `failed`.
- Safe errors: `{"error":{"code":"...","message":"...","retryable":true}}`. No raw exceptions, credentials, upstream response bodies, or operating-system paths are returned.
- Invalid requests: 400; missing/incorrect bearer: 401; unknown job: 404; daily/queue capacity: 429; missing configuration: 503.

Completed results are either `{source,matches,provenance,usage}` or `{not_travel:true,reason,usage}`. `source.analysis_kind` is `ai`; it is never labelled human reviewed. Source and match IDs, source URLs, categories and provider names are controlled or validated by the server. Day `0` means **video highlights without a stated itinerary day**. Activity provider hints are Viator/GetYourGuide; restaurant hints are OpenTable; accommodation hints are Booking. They are search hints, not confirmation that inventory exists.

`provenance` records the submitted canonical `original_url`, resolved `source_url`, media SHA-256, acquisition time, source-association validation method, approximate frame times and source transcript chunks. It explicitly says `manually_reviewed:false`. TikTok `vm`/`vt` short links follow at most three HTTPS allowlisted redirects to a full video URL. Unsupported short links return an actionable request for the full browser URL.

## Bounds and failure behaviour

- One clip per job, maximum 180 seconds, 50 MB download, at most 4096 pixels on either dimension and 8,847,360 pixels per frame.
- Reuses the existing public-media resolvers and their returned-source identity checks. No account cookies, login handling, private-video access, arbitrary URLs, or paywall bypass.
- Up to 48 sampled frames and six 30-second audio chunks. Speech timestamps refer to whole chunks, **not word-level alignment**. Sampling can miss short visual details.
- Uses OpenAI `/v1/audio/transcriptions` with `gpt-transcribe`, followed by `/v1/responses` with images and strict JSON schema. No model tools; all source captions, audio and screen text are treated as untrusted data. Source-grounded quotes are required and uncertain venue names are omitted.
- No bookings or live availability are inferred. Provider API integrations are separate.
- Download/media/API calls have individual limits; each processing subprocess has a 360-second hard deadline. Its process group is killed on timeout/shutdown and temporary media is removed. Raw video/audio/frames are not stored on the persistent volume.
- Accepted jobs consume the daily cap even if extraction fails, to limit retries and spending. The cap is a job limit, not an exact monetary budget. Set an OpenAI project budget separately.
- Duplicate pending/completed source URLs reuse their job for 24 hours. Failed jobs may be resubmitted and consume quota. Completed/failed records and their transcript evidence older than seven days are pruned on the next new submission. Gateway caches have separate retention.
- A service restart preserves completed results and marks queued/processing jobs as retryable `service_restarted`; it does not silently resume potentially billed AI calls.

Public Instagram and TikTok delivery can change or block datacentre requests. Existing TikTok acquisition uses a third-party resolver. A failed or login-gated source returns `source_unavailable`; this implementation does not promise every public social link will resolve.

## Verification

From the `extraction-worker` directory:

```sh
python3 -m unittest discover -s service/tests -v
```

The tests mock OpenAI and social-network access. They exercise the HTTP authentication/job-poll contract, SQL quota races, atomic claims, restart handling, media cleanup, redirects, evidence constraints, request formats, pre-decode media bounds and volume privilege drop. They require a loopback socket for the HTTP integration test and make no paid API calls.

For local development with Python 3.12, curl and ffmpeg installed, securely configure the two required variables, set `REELTRIP_DATA_DIR` to a writable temporary directory, then run `python3 -m service.server`. Docker/Railway uses the bootstrap instead.

Deployment still needs a real funded OpenAI key, matching gateway secret, Railway volume and a successful container build. Mock tests are not proof of live social acquisition, transcription, analysis quality, production availability, or a completed deployment. After setup, perform an owner-approved end-to-end test using a known public video and verify the extracted names/timestamps against that source before public launch.
