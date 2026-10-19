import {apiUser} from '@/lib/auth';
import {sameOrigin} from '@/lib/http';
import {db} from '@/lib/db';
export const dynamic='force-dynamic';
export async function GET(r:Request){const user=await apiUser(r);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});const p=(await db.query<any>('SELECT recruitment_alerts FROM profiles WHERE user_id=$1',[user.id])).rows[0];return Response.json({enabled:Boolean(p?.recruitment_alerts)});}
export async function PUT(r:Request){const user=await apiUser(r);if(!user)return Response.json({error:'로그인이 필요합니다.'},{status:401});if(!sameOrigin(r))return Response.json({error:'요청 출처 오류'},{status:403});const b=await r.json();if(typeof b.enabled!=='boolean')return Response.json({error:'설정을 확인해 주세요.'},{status:400});await db.query('UPDATE profiles SET recruitment_alerts=$2 WHERE user_id=$1',[user.id,b.enabled]);return Response.json({enabled:b.enabled});}
