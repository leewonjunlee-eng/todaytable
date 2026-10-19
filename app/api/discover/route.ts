import {db} from '@/lib/db';
import {recruitingEvents} from '@/lib/availability';
import {activeShowcase} from '@/lib/showcase';
export const dynamic='force-dynamic';
export async function GET(){
 const [events,active,counts]=await Promise.all([recruitingEvents(),activeShowcase(),db.query<any>("SELECT o.event_id,count(*) n FROM application_options o JOIN applications a ON a.id=o.application_id WHERE a.status='SUBMITTED' GROUP BY o.event_id")]);
 const unique=new Map<string,any>();
 for(const e of events){const key=e.day+e.area;if(!unique.has(key))unique.set(key,{...e,registrations:Number(counts.rows.find(c=>c.event_id===e.id)?.n??0)});else unique.get(key).registrations+=Number(counts.rows.find(c=>c.event_id===e.id)?.n??0);}
 return Response.json({events:[...unique.values()].slice(0,16),sourceRows:active?.summary.sourceRows??null,story:active?{past:active.summary.past,upcoming:active.summary.upcoming,recruiting:active.summary.recruiting,tables:active.summary.tables}:null});
}
