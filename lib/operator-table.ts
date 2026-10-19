import {db} from './db';
import {problem,parseJson} from './operators';
import {isCanonicalUuid} from './domain';
import {workspaceData} from './operator-workspace';
export async function operatorTable(id:string){
 if(!isCanonicalUuid(id))problem('식탁을 찾을 수 없습니다.',404);
 const data=await workspaceData(),table=data.tables.find((t:any)=>t.id===id);if(!table)problem('식탁을 찾을 수 없습니다.',404);
 const [room,messages,attendance,notifications,exceptions,feedback,jobs]=await Promise.all([
  db.query<any>('SELECT id,topics,welcome_message,rules_message,curation_message FROM journey_rooms WHERE table_id=$1',[id]),
  db.query<any>(`SELECT m.id,m.kind,m.body,m.created_at,COALESCE(p.display_name,'운영 안내') author_name FROM journey_messages m JOIN journey_rooms r ON r.id=m.room_id LEFT JOIN profiles p ON p.user_id=m.author_user_id WHERE r.table_id=$1 ORDER BY m.created_at,m.id`,[id]),
  db.query<any>(`SELECT ar.id,ar.status,ar.checked_at,ar.updated_at,p.display_name,tm.user_id,tm.status membership_status FROM attendance_records ar JOIN table_members tm ON tm.application_id=ar.application_id JOIN dining_tables t ON t.id=tm.table_id AND t.event_id=ar.event_id LEFT JOIN profiles p ON p.user_id=tm.user_id WHERE t.id=$1 ORDER BY p.display_name`,[id]),
  db.query<any>(`SELECT n.id,n.message,n.channel,n.status,n.created_at,p.display_name FROM notifications n LEFT JOIN profiles p ON p.user_id=n.recipient_user_id WHERE n.action_url IN ($1,$2) OR (n.event_id=$3 AND EXISTS(SELECT 1 FROM table_members tm WHERE tm.table_id=$4 AND tm.user_id=n.recipient_user_id)) ORDER BY n.created_at DESC`,[`/tables/${id}`,`/tables/${id}/chat`,table.event_id,id]),
  db.query<any>(`SELECT e.id,e.source,e.error,e.status,e.created_at,w.operator_id work_operator_id,w.started_at work_started_at FROM lifecycle_exceptions e LEFT JOIN operator_work_sessions w ON w.exception_id=e.id AND w.ended_at IS NULL WHERE e.entity_id=$1 OR e.entity_id=$2 ORDER BY e.created_at DESC`,[id,table.event_id]),
  db.query<any>(`SELECT COUNT(*) responses,AVG(table_score) table_score,AVG(conversation_score) conversation_score,AVG(venue_score) venue_score,SUM(CASE WHEN return_intent THEN 1 ELSE 0 END) return_intent,SUM(CASE WHEN recommend_intent THEN 1 ELSE 0 END) recommend_intent FROM journey_feedback WHERE table_id=$1`,[id]),
  db.query<any>(`SELECT id,job_type,status,run_at,attempts,last_error FROM scheduled_jobs WHERE payload->>'tableId'=$1 ORDER BY run_at`,[id],`SELECT id,job_type,status,run_at,attempts,last_error FROM scheduled_jobs WHERE json_extract(payload,'$.tableId')=$1 ORDER BY run_at`),
 ]);
 return {table,room:room.rows[0]?{...room.rows[0],topics:parseJson(room.rows[0].topics,[])}:null,messages:messages.rows,attendance:attendance.rows,notifications:notifications.rows,exceptions:exceptions.rows,feedback:feedback.rows[0],jobs:jobs.rows,asOf:new Date().toISOString()};
}
export async function operatorReports(){return (await db.query<any>(`SELECT r.id,r.table_id,r.reason,r.decision,r.note,r.created_at,r.reviewed_at,p.display_name reporter_name,t.display_name target_name,u.restricted_status,e.title,e.area,e.starts_at FROM safety_reports r JOIN users u ON u.id=r.target_user_id LEFT JOIN profiles p ON p.user_id=r.reporter_user_id LEFT JOIN profiles t ON t.user_id=r.target_user_id JOIN dining_tables dt ON dt.id=r.table_id JOIN events e ON e.id=dt.event_id ORDER BY CASE WHEN r.decision='OPEN' THEN 0 ELSE 1 END,r.created_at DESC`)).rows;}
