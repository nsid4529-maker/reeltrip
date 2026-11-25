import {useId} from 'react';

const scenes:Record<string,number>={ella:0,sigiriya:1,kanisha:2,shreya:3,'fitnomads-repeat':4};
const palettes=[['#e5dcc3','#7c9d83','#356653'],['#ebd8b5','#a28f64','#546b46'],['#d3e0d9','#93aa98','#497565'],['#c4dedd','#7daeb3','#3e7480'],['#ead9cd','#b3b28d','#687b5d']];
export function LibraryCover({seed}:{seed:string}){
 const id=useId(),variant=scenes[seed]??Array.from(seed).reduce((value,char)=>(value*31+char.charCodeAt(0))>>>0,0)%5;
 const [sky,hill,foreground]=palettes[variant];
 return <svg className="library-cover" viewBox="0 0 600 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrative travel artwork, not a video thumbnail">
  <defs><linearGradient id={id} x2="0" y2="1"><stop stopColor={sky}/><stop offset="1" stopColor="#f6ead2"/></linearGradient></defs>
  <path fill={'url(#'+id+')'} d="M0 0h600v360H0z"/><circle fill="#fff4d5" cx={variant%2?130:465} cy="82" r="43"/>
  {variant===0?<><path d="M0 230 135 95 250 210 370 65 600 245v115H0" fill={hill}/><path d="M0 286q120-95 270-30t330-70v174H0" fill={foreground}/><path d="M-10 238q320-63 620 7v81q-300-65-620-9" fill="#c4ac7c"/>{[25,110,195,280,365,450,535].map(x=><path key={x} d={`M${x} 352v-61q28-43 56 0v61`} fill={foreground}/>)}<path d="M0 237q300-65 600 6" stroke="#ead4a3" strokeWidth="9" fill="none"/></>:
   variant===1?<><path d="M0 250q150-70 340-28t260-32v170H0" fill={hill}/><path d="m225 247 25-130 37-26h91l35 30 30 132z" fill="#7f8060"/><path d="M0 286q130-59 270-6t330-23v103H0" fill={foreground}/><path d="M0 332q150-33 300-10t300-4" fill="none" stroke="#a6b98d" strokeWidth="5"/></>:
   variant===2?<><path d="M0 255 150 100 310 247 450 133 600 225v135H0" fill={hill}/><path d="M0 285q160-80 300-20t300-35v130H0" fill={foreground}/><path d="M0 340q300-130 600-90" fill="none" stroke="#d8c598" strokeWidth="19"/><g transform="translate(255 240) rotate(-10)"><rect width="140" height="42" rx="6" fill="#b16b4d"/>{[12,43,74,105].map(x=><rect x={x} y="8" width="21" height="18" rx="2" key={x} fill="#e3e7d6"/>)}</g></>:
   variant===3?<><path d="M0 195q170-30 310 7t290-6v164H0" fill={hill}/><path d="M600 210Q260 235 60 360h540" fill="#e5cc9e"/><path d="M0 247q170-35 350 3M0 280q170-35 280 0" stroke="#e3efdf" strokeWidth="5" fill="none"/><path d="M470 360q-10-82 8-160" stroke={foreground} strokeWidth="12" fill="none"/><path d="M479 203q-65-65-112-12 60-18 112 12m0 0q40-80 100-29-55-6-100 29m0 0q10-81-39-74 29 30 39 74" fill={foreground}/></>:
   <><path d="M0 215q100-80 230-20t370-20v185H0" fill={hill}/><path d="M0 280q120-75 300-10t300-35v125H0" fill={foreground}/><path d="M80 360q70-90 210-91t100-64" stroke="#d7c797" strokeWidth="38" fill="none"/><g fill="#426451">{[70,480,535].map((x,i)=><path key={x} d={`m${x} ${240-i*30} 28-88 28 88h-20v45h-16v-45z`}/>)}</g></>}
 </svg>;
}
