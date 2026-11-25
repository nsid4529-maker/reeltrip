# Security review — 17 November 2026

Scope: current ReelTrip guest web app, iPhone wrapper/share extension, public extraction/availability gateway and authenticated Railway processor. This is a targeted code review with regression tests, not a penetration test or certification. The user's security reel was acquired and its speech transcribed: https://www.instagram.com/p/DfsWbkrB6vN/. Its claims are prompts for checking our actual attack surface, not evidence that all these flaws existed here.

| Reel claim | ReelTrip assessment/control |
| --- | --- |
| HTTP/2 rapid reset | Cloudflare/Railway terminate HTTP/2. App code cannot certify edge mitigation. Processor bounds active connections and deadlines; edge DDoS/WAF configuration remains a hosting responsibility. |
| Long-username login bypass | No custom username/password login. Input lengths are bounded before costly processing. |
| Forged SAML | No application SAML parser or SSO implementation. |
| Spoofed Microsoft identity | No Microsoft login or email-based authorization in guest features. |
| GraphQL 2FA batching | No GraphQL or app 2FA endpoints. |
| Replayed 2FA codes | No app-managed 2FA codes. |
| Regex denial of service | Fixed, short patterns on bounded inputs; no user-created regex. Streaming limits also cover missing/dishonest Content-Length. |
| JWT public-key signing confusion | No application JWT verification/signing. Server worker uses an exact random bearer secret with constant-time comparison. |
| Request smuggling | Processor rejects Transfer-Encoding, duplicate Content-Length/Authorization and invalid lengths before dispatch, closes connections; real socket tests verify no job submission. Edge framing is still outside app control. |
| Cache poisoning | API responses, including errors, are no-store. Analysis cache keys come from validated source identity, never arbitrary forwarded-host headers or model metadata. |
| Spoofed rate-limit headers | Gateway only uses Cloudflare's edge-set CF-Connecting-IP, ignores X-Forwarded-For/X-Real-IP/Forwarded; missing identity shares one bucket. Global caps also apply. Deployment must remain behind Cloudflare. |
| RLS view bypass | No client-exposed database or RLS views. D1/SQLite access is server-only and parameterized. Public source analyses are shared; personal library/notes stay on-device. |
| Predictable random tokens | Worker secret is cryptographically random; public job IDs use crypto.randomUUID and Python uuid4. No Math.random-based authorization. |
| Timing token guesses | hmac.compare_digest checks worker authentication. No raw credential logs or reflected provider errors. |
| Cookie padding oracle | No custom encrypted authentication cookies. Platform authentication is not reimplemented. |
| Prototype pollution | No user-controlled deep merge or executable deserialization. Validation selects known analysis fields; source objects cannot choose providers or URLs. |
| Template execution | Reel text is rendered as React text. No eval, generated templates or user HTML. Media subprocesses use argument arrays, not shell interpolation. |
| XXE | No application XML parsing. FFmpeg/ffprobe are limited to local file/pipe protocols; platform video URLs/CDNs are allowlisted. |
| WebSocket hijacking | No production application WebSocket endpoint. Dev-server sockets are not production services. |
| Unicode username impersonation | Creator labels are provenance, never authorization. Real source URL/post identity is retained; user content cannot change authenticated service identity. |

Additional controls: incoming JSON max 4–8 KB with 10-second deadline; processor JSON max 180 KB and other provider JSON max 1 MB with streaming cancellation; OAuth response max 16 KB. Invalid bytes, oversized and slow streams have regression tests. External provider redirects are refused. Embedded previews are constructed from validated IDs, sandboxed to provider frames; native bridge messages must come from the trusted main frame. Camera, microphone and geolocation permissions are disabled for the web app.

Paid processing is limited in durable storage: per-visitor/global gateway quotas, atomic quota reservations, two concurrent worker jobs, max queue 20, max 25 new jobs/day, 360-second job deadline. Per-request media is capped at 50 MB/180 seconds/4K dimensions, raw media is cleaned up; worker runs as uid 10001. A visitor who has exhausted a quota cannot consume remaining global quota through repeated denials. These are request/job caps, not a guaranteed dollar budget or protection against every distributed attack. Provider access is currently unconfigured, and actor integrations require explicit enablement and a charge cap.

Multimodal model input is untrusted data, with no tools, strict schema, bounded output, exact speech/caption quote checks, sampled-frame evidence timestamps and server-selected links. Prompt injection and vision hallucinations are not mathematically eliminated; UI labels AI results and unknowns. No arbitrary video facts authorize bookings, external actions or access to secrets.

References: [OWASP unrestricted resource consumption](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/), [Cloudflare request headers and trust boundary](https://developers.cloudflare.com/fundamentals/reference/http-headers/). Remaining release work includes provider access, edge operational review, device/browser testing and independent security testing before broad launch.

17 November 2026 prototype update: bundle chat receives server-loaded source analyses, never client-invented evidence. Its request is capped at 30 KB, generated source context at 90 KB (omissions disclosed), response at 16 KB, with two concurrent service calls and a separate durable 100/day cap. No tools, payment actions or model-selected external URLs. Quote validation uses unique exact speech matches, real frame indices and one bounded correction attempt. Both attempts retain usage records. Native queued shares and bundle changes are validated and replayed idempotently.

Dependency review: critical findings were removed by updating Next, React/RSC, Vinext and Vite with matching peer dependencies. The final npm audit still reports 39 findings (0 critical, 23 high, 15 moderate, 1 low), including transitive development/build tooling. This is not a clean dependency audit or an independent penetration test; do not describe the prototype as ready for broad public launch. Review the exact locked dependency tree again before release beyond controlled testing.

Live-runtime follow-up: Cloudflare fetch supports `manual` redirect mode, not `error`. All upstream requests now use `manual` and reject non-success status codes; a regression verifies one 302 response cannot forward the service credential to its Location. Chat response schemas enumerate exact allowed place IDs. After a bounded video correction, invalid individual evidence can be excluded while verified details are retained with a visible partial-breakdown notice. All-invalid output still fails. Updated checks: 76 web and 35 service tests pass.
