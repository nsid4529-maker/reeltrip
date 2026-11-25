const calendarDate=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});

export function tripDateLabel({start,end}:{start:string;end:string}):string{
 const display=(value:string)=>calendarDate.format(new Date(value+'T00:00:00Z'));
 if(start&&end)return `${display(start)} – ${display(end)}`;
 if(start)return `From ${display(start)} · departure to decide`;
 if(end)return `Until ${display(end)} · arrival to decide`;
 return 'Dates to decide';
}
