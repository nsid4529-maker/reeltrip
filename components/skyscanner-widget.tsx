'use client';
import {useId,useState} from 'react';
import {flightSearchError,type FlightSearch} from '@/lib/travel-connections';
import {SKYSCANNER_WIDGET_MIN_WIDTH,skyscannerWidgetDocument} from '@/lib/skyscanner-widget';

export function SkyscannerWidget({flight}:{flight:FlightSearch}){
 const descriptionId=useId();
 const [loaded,setLoaded]=useState<{document:string;adults:number}|null>(null);
 const error=flightSearchError(flight);
 const document=error?'':skyscannerWidgetDocument(flight);
 const changed=!!loaded&&(loaded.document!==document||loaded.adults!==flight.adults);
 return <div className="provider-widget skyscanner-widget">
  <div className="provider-widget-label"><strong>Skyscanner search preview</strong><span>Results open on Skyscanner</span></div>
  <p id={descriptionId} className="booking-search-note">This independent widget starts with your route and dates. Loading connects to Skyscanner and its <a href="https://www.skyscanner.net/media/privacy-policy" target="_blank" rel="noopener noreferrer">privacy policy</a> applies.</p>
  {!loaded&&<button type="button" className="secondary" disabled={!!error} onClick={()=>setLoaded({document,adults:flight.adults})}>Load Skyscanner search</button>}
  {!loaded&&error&&<p className="fine-print">Enter valid airports, trip dates and travellers above to load the preview.</p>}
  {loaded&&<>
   {changed&&<p role="status" className="booking-search-note">Your trip details changed. Update the preview to use them; this replaces any edits made inside Skyscanner.</p>}
   <div className="state-actions">
    {changed&&<button type="button" className="secondary" disabled={!!error} onClick={()=>setLoaded({document,adults:flight.adults})}>Update Skyscanner preview</button>}
    <button type="button" className="secondary" onClick={()=>setLoaded(null)}>Close preview</button>
   </div>
   <p className="booking-search-note">Select {loaded.adults} {loaded.adults===1?'adult':'adults'} and your cabin in the widget’s traveller selector. For your departure-time filters, use “Search Skyscanner with these filters” above. Changes inside this widget are separate from your ReelTrip selections.</p>
   <div style={{overflowX:'auto',maxWidth:'100%'}}>
    <iframe key={loaded.document} title="Skyscanner flight search" aria-describedby={descriptionId} srcDoc={loaded.document} sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" scrolling="yes" style={{minWidth:SKYSCANNER_WIDGET_MIN_WIDTH,height:650}}/>
   </div>
   <p className="fine-print">Scroll inside the preview if needed. If it stays blank, use the Skyscanner search link above.</p>
  </>}
  <p className="fine-print"><a href="https://www.skyscanner.net/" target="_blank" rel="noopener noreferrer">Skyscanner</a> · <a href="https://www.partners.skyscanner.net/affiliates/travel-widgets-terms-and-conditions" target="_blank" rel="noopener noreferrer">Widget terms</a>. Confirm flight details and book with the provider.</p>
 </div>;
}
