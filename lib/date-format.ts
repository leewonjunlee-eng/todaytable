/** Numeric KST timestamps render identically with Node and browser ICU data. */
export function formatKstDateTime(value:string|Date){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 return `${get('year')}. ${get('month')}. ${get('day')}. ${get('hour')}:${get('minute')}`;
}
