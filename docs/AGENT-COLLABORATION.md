# Built with agents; here’s what I decided

This is an agent-assisted project. I did not hand-write all of this code. Coding agents produced substantial implementation, tests, debugging and documentation. My contribution was defining the product, changing its direction, supplying concrete failure cases and deciding what the prototype should prioritise.

## Decisions I made

- **Start from how people already save inspiration.** I asked for Instagram/TikTok sharing, an understandable Reel Library and topic bundles, rather than an inbox users had to interpret.
- **Make the output actionable.** I pushed the product away from a long descriptive reel summary toward places, maps, dates, group choices and booking handoffs.
- **Preserve useful detail.** I challenged missed restaurant names, transport advice and timing recommendations. Those examples were evidence of an extraction-quality problem, not a request to hard-code a destination.
- **Analyse video as well as audio.** Silent title cards and on-screen place names matter. Audio-only summaries were insufficient.
- **Run processing in the cloud.** People using the app should not need Python or a locally configured worker on their phones.
- **Test failures rather than polish the claims.** I supplied failing links, requested parallel investigation of acquisition and latency, and tested the actual iPhone share flow.
- **Be honest about readiness.** Simulated groups are not customers; one sub-minute run is not a latency guarantee; a signed installation is not full native acceptance.

These decisions are supported by the project conversation. They should not be read as a claim that I personally designed every algorithm or implementation detail.

## What agents contributed

Agents implemented much of the React/TypeScript application, Python processing service, native share extension, provider adapters and regression suite. They diagnosed concrete problems including stale venue-cache identities, duplicate frame mentions, evidence-validation losses and a blank native share panel. Agents also proposed engineering choices such as bounded retries, polling claims and explicit UIKit presentation. Those technical choices are agent contributions, not retroactively claimed as my original designs.

## How I evaluated the work

I inspected the app on my phone, reported failures and missing details, and asked for fixes and measured checks. Agents ran automated tests and live browser checks and recorded their limitations. The final Instagram share-screen repair was confirmed by me on the physical phone. This is distinct from an independent audit or external-user validation.

## What I would discuss in an interview

I can explain the problem, product trade-offs, observed failures and verification process. I would use the architecture note and source to walk through the implementation, clearly separating my decisions from agent-written code. I would not claim users, revenue, production scale, universal social-platform access or successful reservations that have not been demonstrated.
