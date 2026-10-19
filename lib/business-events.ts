import {randomUUID} from 'node:crypto';
import {type QueryClient} from './db';
import {parseJson,problem} from './operators';
export const MESSAGE_DEFAULTS={
 APPLICATION_RECEIVED:'신청과 결제가 완료됐어요. {{schedule}} · 매칭 예정 {{deadline}}. 신청 내용과 수정·취소 방법은 내 식탁에서 확인해 주세요.',
 REFUND_COMPLETED:'환불이 완료됐어요. {{amount}}원 · 결제 내역에서 처리 시각과 금액을 확인해 주세요.',
 TRANSFERRED:'{{schedule}} 일정으로 이동했어요. 매칭 예정 {{deadline}}. 추가 결제는 없어요.',
 REALLOCATING:'선택한 일정 안에서 식탁을 다시 준비하고 있어요. 내 식탁에서 진행 상황을 확인해 주세요.',
 NEW_RECRUITMENT:'선호하는 {{schedule}} 모집이 시작됐어요. 신청 마감 {{deadline}}.',
 CONFIRMED:'식탁이 확정됐어요. {{schedule}} · {{venue}} · 예약명 {{reservation}}.',
 REMINDER:'만남이 다가오고 있어요. {{schedule}} · {{venue}} · 예약명 {{reservation}}.',
 FEEDBACK:'함께한 식탁은 어떠셨나요? 비공개 후기를 남겨 주세요.',
} as const;
export type MessageKind=keyof typeof MESSAGE_DEFAULTS;
export function renderMessage(kind:MessageKind,body:string,variables:Record<string,string>){
 const allowed=[...MESSAGE_DEFAULTS[kind].matchAll(/{{(\w+)}}/g)].map(m=>m[1]);
 if(!body.trim()||body.length>1500||[...body.matchAll(/{{(.*?)}}/g)].some(m=>!allowed.includes(m[1]))||body.replace(/{{\w+}}/g,'').includes('{{'))problem('안내 문구와 허용 변수를 확인해 주세요.');
 for(const name of allowed)if(!body.includes(`{{${name}}}`))problem(`필수 변수 ${name}를 포함해 주세요.`);
 return body.replace(/{{(\w+)}}/g,(_,key)=>{if(typeof variables[key]!=='string')problem(`변수 ${key}가 누락됐어요.`);return variables[key];});
}
/** Persist the exact template and text in the business transaction; the worker delivers once. */
export async function queueBusinessEvent(c:Pick<QueryClient,'query'>,args:{key:string;kind:MessageKind;userId:string;applicationId?:string;eventId?:string;variables?:Record<string,string>;url?:string;fallback?:string}){
 const template=(await c.query<any>('SELECT id,body FROM notification_templates WHERE kind=$1 AND active=true',[args.kind])).rows[0];
 const variables=args.variables??{},message=template?renderMessage(args.kind,template.body,variables):args.fallback??renderMessage(args.kind,MESSAGE_DEFAULTS[args.kind],variables),id=randomUUID();
 const inserted=await c.query('INSERT INTO business_events(id,event_key,kind,user_id,application_id,event_id,variables,template_id,message,action_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(event_key) DO NOTHING',[id,args.key,args.kind,args.userId,args.applicationId??null,args.eventId??null,JSON.stringify(variables),template?.id??null,message,args.url??'/applications']);
 if(inserted.rowCount)await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'DELIVER_BUSINESS_EVENT',$2,now()) ON CONFLICT(job_key) DO NOTHING",[`business:${args.key}`,JSON.stringify({id})]);
 return id;
}
export async function deliverBusinessEvent(c:QueryClient,id:string){
 const event=(await c.query<any>('SELECT * FROM business_events WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!event||event.delivered_at)return;
 await c.query("INSERT INTO notifications(recipient_user_id,event_id,message,sent_by,action_url) VALUES($1,$2,$3,$1,$4)",[event.user_id,event.event_id,event.message,event.action_url]);
 await c.query("INSERT INTO scheduled_jobs(job_key,job_type,payload,run_at) VALUES($1,'PUSH_NOTIFICATION',$2,now()) ON CONFLICT(job_key) DO NOTHING",[`business-push:${id}`,JSON.stringify({recipientUserId:event.user_id,message:event.message,actionUrl:event.action_url})]);
 await c.query('UPDATE business_events SET delivered_at=now() WHERE id=$1',[id]);
}
export const scheduleLabel=(events:any[])=>events.map(e=>`${new Date(e.starts_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} ${e.area}`).join(' / ');
export async function scheduleRecruitmentAlerts(c:QueryClient){
 const events=(await c.query<any>("SELECT * FROM events WHERE status='OPEN' AND application_deadline>now() AND starts_at>now() ORDER BY starts_at,id")).rows;
 const preferences=(await c.query<any>("SELECT p.user_id FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.consent_operations=true AND p.recruitment_alerts=true AND u.restricted_status='ACTIVE'")).rows;
 for(const p of preferences){
  const choices=(await c.query<any>('SELECT e.area,e.starts_at FROM application_options o JOIN applications a ON a.id=o.application_id JOIN events e ON e.id=o.event_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 32',[p.user_id])).rows;const areas=choices.map(e=>e.area),days=choices.map(e=>new Date(+new Date(e.starts_at)+9*3600000).getUTCDay());if(!areas.length)continue;
  const recent=(await c.query("SELECT 1 FROM business_events WHERE user_id=$1 AND kind='NEW_RECRUITMENT' AND created_at>$2",[p.user_id,new Date(Date.now()-7*86400000)])).rowCount;if(recent)continue;
  const event=events.find(e=>areas.includes(e.area)&&days.includes(new Date(new Date(e.starts_at).getTime()+9*3600000).getUTCDay()));if(!event)continue;
  await queueBusinessEvent(c,{key:`recruitment:${p.user_id}:${event.id}`,kind:'NEW_RECRUITMENT',userId:p.user_id,eventId:event.id,variables:{schedule:scheduleLabel([event]),deadline:new Date(event.application_deadline).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})},url:'/apply'});
 }
}
