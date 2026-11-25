import {WorkspaceHeader} from '@/components/workspace-navigation';
import {EVENT_PROPS} from '@/lib/events';

export const metadata={title:'What ReelTrip stores · ReelTrip',description:'What ReelTrip stores during the group test, who else sees it, and how to delete it.'};

// Plain-language privacy notice for the closed group test. Regression checks
// cover the table/cookie inventory, event fields and retention descriptions.
const EVENT_WORDS:Record<keyof typeof EVENT_PROPS,string>={
 reel_added:'Reel added — where it came from (link, upload or share), the platform, and whether it went into a bucket.',
 place_viewed:'Place viewed — the place’s short ID in the bucket, such as “paradise-breakfast”.',
 vote_cast:'Vote cast — the place’s short ID and whether it was keep or skip.',
 member_joined:'Member joined — nothing else.',
 plan_finished:'Shortlist agreed — how many places had at least one keep vote.',
 outbound_click:'Booking link clicked — which partner (for example Booking.com) and the kind of link. Never the address, venue or your dates.',
};
export const SERVER_TABLES=['members','shared_buckets','bucket_members','bucket_invites','bucket_reels','place_votes','place_resolutions','events','analysis_cache','processing_jobs','usage_counters','provider_calls'];
export const PROCESSOR_TABLES=['jobs','daily_usage','chat_usage','uploads','upload_usage'];
export const COOKIES=['__Host-reeltrip_member','reeltrip_upload_owner'];

export default function PrivacyPage(){
 return <div className="reel-app"><WorkspaceHeader active="shared"/><main className="reservation-examples shared-page privacy-page">
  <article aria-labelledby="privacy-heading">
   <div className="eyebrow">PRIVACY · GROUP TEST</div>
   <h1 id="privacy-heading">What ReelTrip stores</h1>
   <p className="reservation-intro">ReelTrip is in a small test with friendly groups. This page explains what the test stores, who else receives it, and how to request deletion. Updated 23 November 2026.</p>

   <section aria-labelledby="p-short"><h2 id="p-short">In short</h2><ul>
    <li>You join a bucket with a name. No email, password or phone number.</li>
    <li>ReelTrip keeps the reel links your group adds, the places found in them, your votes and your trip dates, so everyone in the bucket sees the same plan.</li>
    <li>To find the places, reels are analysed by our video service and OpenAI, and place names are looked up on Google Maps.</li>
    <li>It records a few usage events with member and bucket IDs. Place views and votes include a short place ID, which may contain a place name. Events do not include videos, captions, messages or bookings.</li>
    <li>ReelTrip books nothing. Booking links take you to the partner, where you check the price, availability and terms.</li>
    <li>The bucket owner can delete the shared bucket’s records at any time. Separate caches, video processing records and data on your device are described below.</li>
   </ul></section>

   <section aria-labelledby="p-server"><h2 id="p-server">On ReelTrip’s servers</h2>
    <table className="privacy-table"><thead><tr><th scope="col">What</th><th scope="col">Why</th><th scope="col">How long</th></tr></thead><tbody>
     <tr><td>Your name, and a scrambled copy (a hash) of your device’s cookie</td><td>To show your group who added and voted on what</td><td>Until the bucket is deleted, if you’re in no other bucket</td></tr>
     <tr><td>Each shared bucket: its name, members, owner, trip dates, number of travellers, and who agreed the shortlist and when</td><td>The shared plan</td><td>Until the owner deletes it</td></tr>
     <tr><td>Reel links added to a bucket, who added them, and the places found: name, area, category, a short quote from the reel, the second it appears and the creator’s name</td><td>So votes and places stay put after the analysis cache expires</td><td>Until the reel is removed or the bucket is deleted</td></tr>
     <tr><td>Votes: keep or skip, per person per place</td><td>Vote totals</td><td>Until the reel is removed or the bucket is deleted</td></tr>
     <tr><td>Invite links, stored only as a hash</td><td>To let people join</td><td>Each works for 14 days; the record goes when the bucket is deleted</td></tr>
     <tr><td>Usage events (list below), with your member ID when present and the bucket when supplied</td><td>To learn whether groups reach a plan</td><td>Bucket events go when that bucket is deleted; other events need manual cleanup or deletion of the member record</td></tr>
     <tr><td>Google Maps place IDs and ReelTrip’s match records (see below)</td><td>To show the real venue and pin it on the map</td><td>Place IDs kept until their match records are removed; Google coordinates are fetched live and are not saved in ReelTrip’s database</td></tr>
     <tr><td>A public reel’s analysis and processing reference, keyed by the reel link</td><td>So the same reel isn’t paid for twice</td><td>Expires from use after 1 day; expired rows are cleared on a later analysis request</td></tr>
     <tr><td>Rate-limit counters: a one-way hash of your IP address or member ID and a short time window</td><td>To stop abuse and runaway costs</td><td>Eligible for cleanup after about 2 days; cleared on later requests</td></tr>
     <tr><td>Daily counts of calls to Google</td><td>Cost tracking; nothing about you or the places</td><td>Kept</td></tr>
     <tr><td>Video service job records: source link, status, extracted places and transcript evidence, or an error</td><td>To process reels and recover interrupted work</td><td>Completed and failed records older than 7 days are cleared on a new job submission</td></tr>
     <tr><td>A video you upload yourself (optional), its filename and technical details, and a browser-specific owner code</td><td>To analyse it and restrict access to the browser that uploaded it</td><td>Video access expires after 7 days; the running service clears expired files. Metadata remains for at least 14 days, and while a recent analysis needs it. Private analysis access expires 7 days after processing</td></tr>
     <tr><td>Video service daily job, chat and upload counts; upload counts include the browser-specific owner code</td><td>To limit processing costs</td><td>Job and upload counts become eligible for cleanup after 7 days; chat counts after the day ends. Cleanup depends on later service activity</td></tr>
    </tbody></table>
   </section>

   <section aria-labelledby="p-cookies"><h2 id="p-cookies">Cookies</h2><ul>
    <li><code>__Host-reeltrip_member</code> remembers you on this device so you don’t sign in. It holds a random code, not your name, and lasts a year. Clearing it means this device no longer knows you; open the invite link again to rejoin under a new name.</li>
    <li><code>reeltrip_upload_owner</code> is set only if you upload a video, so only your browser can open it. It lasts 30 days.</li>
    <li>ReelTrip sets no advertising or tracking cookies and uses no analytics service. If you choose Preview this reel, Instagram or TikTok loads in a frame; if you load the flight search widget, Skyscanner does; and opening the map loads Google Maps. Those services may set their own cookies.</li>
   </ul></section>

   <section aria-labelledby="p-device"><h2 id="p-device">On your device only</h2>
    <p>Your personal Reel Library, bundles, personal buckets, itinerary notes, place fixes you make outside a shared bucket, and which tips you’ve hidden are stored in this browser, not on our servers. Clearing your browser data removes them.</p>
    <p>The iPhone app also keeps saved reel links, personal bundle details, a shared-bucket picker cache and pending share or Interested saves in its own device storage, without automatic expiry. Removing a personal reel removes its saved native copy; processed pending actions are removed after the app acknowledges them. The app and Safari have separate cookies and browser storage. Clearing browser data or deleting a shared bucket does not clear these native files.</p>
   </section>

   <section aria-labelledby="p-others"><h2 id="p-others">Who else sees your data</h2><ul>
    <li><strong>The people in your bucket</strong> see your name, the reels you add, your votes and any place fixes you make.</li>
    <li><strong>Our video service and OpenAI.</strong> When you analyse a reel, our video service (hosted on Railway) fetches the public video, and sends sampled frames, audio and captions to OpenAI to find the places. TikTok links go to the configured downloader, tikwm or Apify. Temporary working copies are removed when processing ends; optional uploaded videos follow the retention above. These providers handle the data they receive under their own policies; deleting a bucket does not delete their records. Bundle chat, if you use it, sends your messages and the breakdowns to OpenAI.</li>
    <li><strong>Google.</strong> Place names from reels are looked up on Google Maps from our server. If you open the map, your browser loads Google Maps directly, and Google’s privacy policy applies.</li>
    <li><strong>Booking partners.</strong> When you click a booking link, the selected partner receives the destination or venue, and supported dates and traveller details. Partners include Booking.com, Expedia, Airbnb, Viator, GetYourGuide, OpenTable, SevenRooms and Skyscanner. Some links are referral links and say so; ReelTrip may earn a commission.</li>
    <li><strong>Cloudflare</strong> hosts ReelTrip and its database.</li>
   </ul><p>We don’t sell your data. ReelTrip links back to creators’ reels and does not publish copies of their videos.</p></section>

   <section aria-labelledby="p-google"><h2 id="p-google">Google Maps data</h2>
    <p>For venue matches, ReelTrip stores the Google place ID, plus ReelTrip’s own match status, confidence and who fixed a match. Google coordinates are fetched live when you open the map and are not saved in ReelTrip’s database. The Google place ID is kept until its match record is removed. Google’s name, address and Google Maps link are fetched live each time you open a place and are never stored; names and quotes extracted from the reel are stored separately. “Last checked” is when ReelTrip last confirmed the match. Opening hours aren’t shown. Venue details and the map are attributed to Google Maps, and pins appear only on Google’s map.</p>
   </section>

   <section aria-labelledby="p-events"><h2 id="p-events">Usage events</h2>
    <p>These are the only product event types ReelTrip accepts. Their properties are limited to short IDs, specified codes, counts and yes/no values. Place IDs may be derived from place names. Each event also stores a timestamp, your member ID when available, and the supplied bucket ID. Events contain no video, caption, message or booking details.</p>
    <ul>{(Object.keys(EVENT_PROPS) as (keyof typeof EVENT_PROPS)[]).map(name=><li key={name}>{EVENT_WORDS[name]}</li>)}</ul>
   </section>

   <section aria-labelledby="p-delete"><h2 id="p-delete">Deleting your data</h2><ul>
    <li><strong>Bucket owners:</strong> open the bucket and choose Delete this bucket. It removes the reels, places, votes, place fixes, invite links, trip details and the bucket’s events straight away, plus the name and events of anyone who isn’t in another bucket.</li>
    <li><strong>Anyone else:</strong> remove reels you added with Remove. For other deletion requests, contact <strong>Siddarth Nair (Founder)</strong> at <a href="mailto:privacy@example.com">privacy@example.com</a>; those requests are handled manually. Siddarth coordinates any necessary cache, processor, provider or device cleanup and explains anything that remains.</li>
    <li>Deleting a bucket does not remove the separate analysis cache, video service jobs or uploads, global place matches, provider records or your device’s personal library. Their retention is described above. Clear browser data to remove the personal library and cookies from that browser; this does not clear the iPhone app’s native files.</li>
    <li>There is no automatic end-of-test deletion for shared test data. Siddarth is responsible for arranging, carrying out and checking the test-wide cleanup, and communicating its date and scope to testers.</li>
   </ul></section>

   <details className="privacy-technical"><summary>Technical detail</summary>
    <p>Web database tables: {SERVER_TABLES.map((t,i)=><span key={t}>{i?', ':''}<code>{t}</code></span>)}. Video service tables: {PROCESSOR_TABLES.map((t,i)=><span key={t}>{i?', ':''}<code>{t}</code></span>)}. Cookies: {COOKIES.map((c,i)=><span key={c}>{i?', ':''}<code>{c}</code></span>)}. Events: {Object.keys(EVENT_PROPS).map((e,i)=><span key={e}>{i?', ':''}<code>{e}</code></span>)}.</p>
   </details>
  </article>
 </main></div>;
}
