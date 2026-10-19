import {randomUUID} from 'node:crypto';
import {db,databaseProvider} from './db';
import {workspaceData} from './operator-workspace';
import {venueCatalog,recommendVenues} from './venues';
import {isCanonicalUuid} from './domain';
import {parseJson,problem} from './operators';
import {runAutomaticMatching} from './automatic-matching';
export async function bookingBoard(){
 const data=await workspaceData(),venues=await venueCatalog(),operators=(await db.query<any>('SELECT user_id,display_name FROM operator_profiles WHERE active=true ORDER BY display_name')).rows;
 return {tables:data.tables.filter(t=>t.status==='CONFIRMED'&&t.event&&+new Date(t.event.ends_at)>Date.now()).sort((a,b)=>+new Date(a.event!.starts_at)-+new Date(b.event!.starts_at)),needsVenue:data.proposals.filter(p=>p.event&&+new Date(p.event.application_deadline)<=Date.now()&&+new Date(p.event.ends_at)>Date.now()),venues,operators};
}
export async function updateBooking(actorId:string,b:any){
 if(!b||!['UPDATE','RESOLVE_VENUE'].includes(b.action)||!Number.isInteger(b.version))problem('예약 정보를 확인해 주세요.');
 const c=await db.connect();try{
  await c.query('BEGIN');if(databaseProvider==='postgres')await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
  if(!(await c.query('SELECT 1 FROM operator_profiles WHERE user_id=$1 AND active=true FOR UPDATE',[actorId])).rowCount)problem('활성 운영자 권한이 필요합니다.',403);
  if(b.action==='RESOLVE_VENUE'){
   if(!isCanonicalUuid(b.proposalId)||!isCanonicalUuid(b.venueId))problem('식당 확인 대상을 선택해 주세요.');
   const p=(await c.query<any>('SELECT * FROM matching_proposals WHERE id=$1 FOR UPDATE',[b.proposalId])).rows[0];
   if(!p||!['PENDING','HELD'].includes(p.status))problem('이미 처리되었거나 변경된 매칭입니다.',409);
   if(Number(p.version)!==b.version)problem('다른 운영자가 식당 확인 내용을 변경했어요.',409);
   const event=(await c.query<any>("SELECT *,COALESCE(ends_at,starts_at+interval '2 hours') effective_end FROM events WHERE id=$1",[p.event_id],"SELECT *,COALESCE(ends_at,datetime(starts_at,'+2 hours')) effective_end FROM events WHERE id=$1")).rows[0];event.ends_at=event.effective_end;
   const choices=await recommendVenues(c,event,parseJson(p.candidates,[]),{proposalId:p.id,sourceTableId:p.source_table_id});const venue=choices.find(v=>v.id===b.venueId);
   if(!venue?.eligible)problem('지역·식사 예산·남은 정원을 만족하는 식당을 골라주세요.',409);
   if(venue.requiresDietaryConfirmation&&b.dietaryConfirmed!==true)problem('참가자의 음식·알레르기 요청을 식당에 확인해 주세요.');
   await c.query("UPDATE matching_proposals SET venue_id=$2,dietary_verified=$3,status='PENDING',reviewed_by=NULL,version=version+1 WHERE id=$1",[p.id,venue.id,b.dietaryConfirmed===true]);
   await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES($1,'VENUE_CONDITIONS_VERIFIED','matching_proposal',$2,$3)",[actorId,p.id,JSON.stringify({venueId:venue.id,dietaryConfirmed:b.dietaryConfirmed===true})]);
   const result=await runAutomaticMatching(p.event_id,'venue-conditions-resolved',c);await c.query('COMMIT');return {ok:true,matchedCount:result.matchedCount};
  }
  if(!isCanonicalUuid(b.tableId)||!isCanonicalUuid(b.venueId)||!['TO_BOOK','REQUESTED','CONFIRMED','CHANGE_NEEDED'].includes(b.status))problem('식탁과 예약 상태를 확인해 주세요.');
  for(const [key,max] of [['reservationName',100],['confirmationCode',100],['note',2000]] as const)if(typeof(b[key]??'')!=='string'||(b[key]??'').length>max)problem('예약명·확인번호·메모 길이를 확인해 주세요.');
  if(!(b.reservationName??'').trim())problem('식당에 전달할 예약명을 입력해 주세요.');
  if(b.assignedTo&&!(await c.query('SELECT 1 FROM operator_profiles WHERE user_id=$1 AND active=true',[b.assignedTo])).rowCount)problem('활성 운영자에게만 담당을 배정할 수 있어요.');
  const table=(await c.query<any>("SELECT t.*,e.starts_at event_start,e.area event_area,COALESCE(e.ends_at,e.starts_at+interval '2 hours') event_end FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.id=$1 FOR UPDATE OF t",[b.tableId],"SELECT t.*,e.starts_at event_start,e.area event_area,COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours')) event_end FROM dining_tables t JOIN events e ON e.id=t.event_id WHERE t.id=$1")).rows[0];
  if(!table||table.status!=='CONFIRMED'||+new Date(table.event_end)<=Date.now())problem('다가오는 확정 식탁만 예약을 수정할 수 있어요.',409);
  await c.query("INSERT INTO venue_booking_tasks(table_id,reservation_name) VALUES($1,'우연한 식탁') ON CONFLICT(table_id) DO NOTHING",[table.id]);
  const task=(await c.query<any>('SELECT * FROM venue_booking_tasks WHERE table_id=$1 FOR UPDATE',[table.id])).rows[0];
  if(Number(task.version)!==b.version)problem('다른 운영자가 예약 내용을 변경했어요. 새로고침해 주세요.',409);
  const changed=table.venue_id!==b.venueId;
  const people=(await c.query<any>("SELECT tm.user_id user_id,pr.interests FROM table_members tm JOIN profiles pr ON pr.user_id=tm.user_id WHERE tm.table_id=$1 AND tm.status='ACTIVE'",[table.id])).rows;
  if(changed){
   const choices=await recommendVenues(c,{area:table.event_area,starts_at:table.event_start,ends_at:table.event_end},people.map(m=>({...m,userId:m.user_id})),{sourceTableId:table.id});const venue=choices.find(v=>v.id===b.venueId);
   if(!venue?.eligible)problem('희망 지역·식사 예산·남은 정원을 만족하는 식당으로 변경해 주세요.',409);
   if(venue.requiresDietaryConfirmation&&b.dietaryConfirmed!==true)problem('변경할 식당에 음식·알레르기 요청을 확인해 주세요.');
   if(b.status!=='TO_BOOK')problem('식당을 바꾸면 예약 대기 상태로 다시 확인해 주세요.');
   await c.query('UPDATE dining_tables SET venue_id=$2 WHERE id=$1',[table.id,b.venueId]);
  }
  await c.query('UPDATE venue_booking_tasks SET status=$2,reservation_name=$3,confirmation_code=$4,note=$5,assigned_to=$6,updated_by=$7,version=version+1,updated_at=now() WHERE table_id=$1',[table.id,b.status,b.reservationName.trim(),changed?'':b.confirmationCode??'',b.note??'',b.assignedTo||null,actorId]);
  await c.query("INSERT INTO table_reservations(id,table_id,venue_id,reservation_name,meeting_time,status,provider) VALUES($1,$2,$3,$4,$5,'CONFIRMED','MOCK') ON CONFLICT(table_id) DO UPDATE SET venue_id=excluded.venue_id,reservation_name=excluded.reservation_name",[randomUUID(),table.id,b.venueId,b.reservationName.trim(),table.event_start]);
  if(changed){
   const venue=(await c.query<any>('SELECT name,address FROM venues WHERE id=$1',[b.venueId])).rows[0],message=`만날 식당이 ${venue.name}(으)로 변경되었어요. 식탁 안내에서 위치를 확인해 주세요.`;
   for(const m of people)await c.query('INSERT INTO notifications(recipient_user_id,event_id,message,sent_by,action_url) VALUES($1,$2,$3,$4,$5)',[m.user_id,table.event_id,message,actorId,`/tables/${table.id}`]);
   const room=(await c.query<any>('SELECT id FROM journey_rooms WHERE table_id=$1',[table.id])).rows[0];
   if(room)await c.query("INSERT INTO journey_messages(id,room_id,body,request_key,kind) VALUES($1,$2,$3,$4,'SYSTEM')",[randomUUID(),room.id,`${message} 주소: ${venue.address}`,randomUUID()]);
  }
  await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) VALUES($1,'VENUE_BOOKING_UPDATED','dining_table',$2,$3,$4)",[actorId,table.id,JSON.stringify({venueId:table.venue_id,...task}),JSON.stringify({venueId:b.venueId,status:b.status,reservationName:b.reservationName,confirmationCode:b.confirmationCode??'',note:b.note??'',assignedTo:b.assignedTo||null})]);
  await c.query('COMMIT');return {ok:true,version:b.version+1};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
