import {db,type QueryClient} from './db';
import {parseJson} from './operators';
export type ShowcaseSummary={sourceRows:number;participants:number;applications:number;past:number;upcoming:number;recruiting:number;tables:number;eventIds:string[];userIds:string[];anchorDate:string};
export async function activeShowcase(client:Pick<QueryClient,'query'>=db){
 const row=(await client.query<any>('SELECT id,summary,created_at FROM showcase_batches WHERE active=true')).rows[0];
 return row?{id:row.id,createdAt:row.created_at,summary:parseJson<ShowcaseSummary>(row.summary,{} as ShowcaseSummary)}:null;
}
export async function participantShowcase(userId:string,client:Pick<QueryClient,'query'>=db){
 const active=await activeShowcase(client);if(!active)return null;
 const member=await client.query('SELECT user_id FROM showcase_members WHERE batch_id=$1 AND user_id=$2 UNION ALL SELECT user_id FROM showcase_viewers WHERE batch_id=$1 AND user_id=$2',[active.id,userId]);
 return member.rowCount?active:null;
}

/** Keep the active operating inbox coherent while retaining older tickets by ID. */
export async function showcaseTickets<T extends {application_id?:string;created_at:string}>(rows:T[]){
 const active=await activeShowcase();if(!active)return rows;
 const events=new Set(active.summary.eventIds),options=(await db.query<any>('SELECT application_id,event_id FROM application_options')).rows;
 const apps=new Set(options.filter(o=>events.has(o.event_id)).map(o=>o.application_id));
 return rows.filter(t=>apps.has(t.application_id)||+new Date(t.created_at)>=+new Date(active.createdAt));
}
