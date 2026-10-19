import {apiUser} from '@/lib/auth';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await apiUser(request);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});
 const [profile,test,applications,payments,feedback,messages,requests]=await Promise.all([
  db.query('SELECT display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,desired_traits,food_budgets,dietary_notes,consent_privacy,consent_operations,consent_version,updated_at FROM profiles WHERE user_id=$1',[user.id]),
  db.query('SELECT test_version,answers,result_title,updated_at FROM profile_tests WHERE user_id=$1',[user.id]),
  db.query('SELECT id,status,matching_status,pass_choice,amount_cents,created_at FROM applications WHERE user_id=$1',[user.id]),
  db.query('SELECT p.id,p.application_id,p.status,p.amount_cents,p.created_at FROM payments p JOIN applications a ON a.id=p.application_id WHERE a.user_id=$1',[user.id]),
  db.query('SELECT * FROM journey_feedback WHERE author_user_id=$1',[user.id]),
  db.query('SELECT id,room_id,body,created_at FROM journey_messages WHERE author_user_id=$1',[user.id]),
  db.query('SELECT number,subject,status,created_at FROM support_tickets WHERE user_id=$1',[user.id]),
 ]);
 const [preferences,entitlements,attendance,notifications,conversations,deletions,checkouts]=await Promise.all([
  db.query('SELECT * FROM participant_preferences WHERE user_id=$1',[user.id]),db.query('SELECT * FROM entitlements WHERE user_id=$1',[user.id]),
  db.query('SELECT ar.* FROM attendance_records ar JOIN applications a ON a.id=ar.application_id WHERE a.user_id=$1',[user.id]),
  db.query('SELECT id,message,status,created_at FROM notifications WHERE recipient_user_id=$1',[user.id]),
  db.query("SELECT m.id,m.ticket_id,m.body,m.author_name,m.created_at FROM support_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.user_id=$1 AND m.kind='PUBLIC'",[user.id]),
  db.query('SELECT status,reason,result,created_at,completed_at FROM deletion_requests WHERE user_id=$1',[user.id]),db.query('SELECT id,selection,status,expires_at,created_at FROM checkout_sessions WHERE user_id=$1',[user.id])]);
 const result={exportedAt:new Date().toISOString(),account:{email:user.email},profile:profile.rows[0]??null,preferenceTest:test.rows[0]??null,applications:applications.rows,payments:payments.rows,feedback:feedback.rows,messages:messages.rows,requests:requests.rows,preferences:preferences.rows,entitlements:entitlements.rows,attendance:attendance.rows,notifications:notifications.rows,conversations:conversations.rows,deletions:deletions.rows,checkouts:checkouts.rows};
 return new Response(JSON.stringify(result,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="todaytable-my-records.json"','Cache-Control':'private, no-store'}});
}
