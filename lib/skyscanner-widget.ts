import {flightSearchError,skyscannerSearchUrl,type FlightSearch} from './travel-connections.ts';

export const SKYSCANNER_WIDGET_LOADER_URL='https://widgets.skyscanner.net/widget-server/js/loader.js';
export const SKYSCANNER_WIDGET_MIN_WIDTH=300;

const escapeAttribute=(value:string)=>value.replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));

// Official Flight Search widget: https://www.partners.skyscanner.net/affiliates/widgets-documentation/flight-search-widget
// Loader example: https://codepen.io/Skyscanner/pen/VBqGPW
// The documented options do not preset adult counts or departure-time ranges.
// Those remain supported on our separate public search link; do not invent
// widget parameters or insert an unverified affiliate/associate identifier.
export function skyscannerWidgetDocument(input:FlightSearch):string{
 const error=flightSearchError(input);
 if(error)throw new Error(error);
 const attributes:Record<string,string>={
  'data-skyscanner-widget':'FlightSearchWidget',
  'data-locale':'en-GB',
  'data-market':'UK',
  'data-currency':input.currency,
  'data-origin-iata-code':input.origin.trim().toUpperCase(),
  'data-destination-iata-code':input.destination.trim().toUpperCase(),
  'data-flight-type':'return',
  'data-flight-outbound-date':input.dates.start,
  'data-flight-inbound-date':input.dates.end,
  'data-direct-flights':'true',
  'data-direct-flights-is-checked':String(input.directOnly||false),
  'data-multi-city-max-flights-number':'0',
  'data-target':'_blank',
  'data-web-only-redirects':'true'
 };
 const markup=Object.entries(attributes).map(([key,value])=>`${key}="${escapeAttribute(value)}"`).join(' ');
 const fallback=escapeAttribute(skyscannerSearchUrl(input));
 // Run only in a sandboxed srcDoc frame without same-origin access. Preserve
 // Skyscanner's own rendering and attribution; never inspect or copy results.
 // The loader starts its nested frame at height:0 and cannot always receive
 // its resize message in an opaque-origin sandbox. Give the host and nested
 // frame real space without granting provider scripts access to ReelTrip.
 // Narrow layouts get more room for the provider's stacked fields/calendar.
 return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><title>Skyscanner flight search</title><style>html,body{margin:0;min-width:300px;background:#fff;color:#253b34;font:14px Arial,sans-serif}body{box-sizing:border-box}.skyscanner-frame{position:relative;min-height:640px}.skyscanner-frame iframe{min-height:640px}@media(max-width:480px){.skyscanner-frame,.skyscanner-frame iframe{min-height:800px}}a{color:#2f7258}p{line-height:1.5}</style></head><body><div class="skyscanner-frame"><div ${markup}></div></div><p><a href="${fallback}" target="_blank" rel="noopener noreferrer">Open your search on Skyscanner</a></p><script src="${SKYSCANNER_WIDGET_LOADER_URL}" async></script></body></html>`;
}
