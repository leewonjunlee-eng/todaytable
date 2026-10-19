import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import {isAllowedGenderComposition} from '@/lib/matching';
import { databaseProvider,db } from '@/lib/db';
import {profileInput} from '@/lib/profile-validation';
import { sameOrigin } from '@/lib/http';
import {PROFILE_TEST_VERSION,profileTestResult,validProfileTestAnswers} from '@/lib/profile-test';

export const runtime = 'nodejs';
export const dynamic='force-dynamic';

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const result = await db.query(
    `SELECT display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,
            desired_traits,food_budgets,dietary_notes,consent_privacy,consent_operations,consent_version
     FROM profiles WHERE user_id=$1`,
    [user.id],
  );
  const profile=result.rows[0] as any;
  if(!profile)return NextResponse.json(null);
  const test=(await db.query('SELECT test_version,answers,result_title,updated_at FROM profile_tests WHERE user_id=$1',[user.id])).rows[0];
  return NextResponse.json({...profile,gender:profile.gender==='NON_BINARY'?'PREFER_NOT_TO_SAY':profile.gender,profile_test:test?{...test,answers:typeof test.answers==='string'?JSON.parse(test.answers):test.answers}:null});
}

export async function PUT(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  }

  const client=await db.connect();
  try {
    const parsed=await request.json();
    const raw=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
    const {value:body,fields}=profileInput(raw);
    if(raw.testAnswers!==undefined&&!validProfileTestAnswers(raw.testAnswers))fields.testAnswers='각 질문의 답변을 선택해 주세요.';
    if(Object.keys(fields).length)return NextResponse.json({error:Object.values(fields)[0],fields},{status:400});

    await client.query('BEGIN');
    if(databaseProvider==='postgres')await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:lifecycle',0))");
    const prior=(await client.query<any>('SELECT gender FROM profiles WHERE user_id=$1',[user.id])).rows[0];
    if(!['MAN','WOMAN'].includes(body.gender)){
      const paid=await client.query("SELECT 1 FROM applications a JOIN payments p ON p.application_id=a.id WHERE a.user_id=$1 AND a.status='SUBMITTED' AND p.status='PAID' LIMIT 1",[user.id]);
      if(paid.rowCount){await client.query('ROLLBACK');const error='진행 중인 유료 신청의 매칭을 위해 성별 선택을 유지해야 해요. 신청을 먼저 취소하거나 운영팀에 문의해 주세요.';return NextResponse.json({error,fields:{gender:error}},{status:409});}
    }
    if(prior&&prior.gender!==body.gender){
      const seats=(await client.query<any>(`SELECT tm.table_id,tm.user_id,p.gender FROM table_members tm JOIN profiles p ON p.user_id=tm.user_id JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.status='ACTIVE' AND t.status='CONFIRMED' AND COALESCE(e.ends_at,e.starts_at+interval '2 hours')>now() AND tm.table_id IN (SELECT table_id FROM table_members WHERE user_id=$1 AND status='ACTIVE')`,[user.id],`SELECT tm.table_id,tm.user_id,p.gender FROM table_members tm JOIN profiles p ON p.user_id=tm.user_id JOIN dining_tables t ON t.id=tm.table_id JOIN events e ON e.id=t.event_id WHERE tm.status='ACTIVE' AND t.status='CONFIRMED' AND COALESCE(e.ends_at,datetime(e.starts_at,'+2 hours'))>CURRENT_TIMESTAMP AND tm.table_id IN (SELECT table_id FROM table_members WHERE user_id=$1 AND status='ACTIVE')`)).rows;
      const invalid=[...new Set(seats.map(s=>s.table_id))].some(id=>{
        const members=seats.filter(s=>s.table_id===id).map(s=>({gender:s.user_id===user.id?body.gender:s.gender}));
        return !isAllowedGenderComposition(members);
      });
      if(invalid){await client.query('ROLLBACK');const error='확정된 만남의 성비 조건이 달라져 운영팀 확인이 필요합니다.';return NextResponse.json({error,fields:{gender:error}},{status:409});}
    }
    await client.query(
      `INSERT INTO profiles(
         user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,
         interests,traits,desired_traits,food_budgets,dietary_notes,
         consent_privacy,consent_operations,consent_version,consented_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,true,'v1',now())
       ON CONFLICT(user_id) DO UPDATE SET
         display_name=excluded.display_name,contact_phone=excluded.contact_phone,
         birth_year=excluded.birth_year,gender=excluded.gender,occupation=excluded.occupation,
         mbti=excluded.mbti,interests=excluded.interests,traits=excluded.traits,
         desired_traits=excluded.desired_traits,food_budgets=excluded.food_budgets,
         dietary_notes=excluded.dietary_notes,consent_privacy=true,consent_operations=true,
         consent_version='v1',consented_at=now(),updated_at=now()`,
      [user.id, body.name.trim(), body.phone.trim(), body.birthYear, body.gender,
        body.occupation.trim(), body.mbti, body.interests, body.traits, body.desiredTraits,
        body.foodBudgets, body.dietaryNotes.trim()],
      `INSERT INTO profiles(
         user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,
         interests,traits,desired_traits,food_budgets,dietary_notes,
         consent_privacy,consent_operations,consent_version,consented_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,1,'v1',CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name=excluded.display_name,contact_phone=excluded.contact_phone,
         birth_year=excluded.birth_year,gender=excluded.gender,occupation=excluded.occupation,
         mbti=excluded.mbti,interests=excluded.interests,traits=excluded.traits,
         desired_traits=excluded.desired_traits,food_budgets=excluded.food_budgets,
         dietary_notes=excluded.dietary_notes,consent_privacy=1,consent_operations=1,
         consent_version='v1',consented_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`,
    );
    if(raw.testAnswers!==undefined){
      const result=profileTestResult(raw.testAnswers);
      await client.query(`INSERT INTO profile_tests(user_id,test_version,answers,result_title) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET test_version=excluded.test_version,answers=excluded.answers,result_title=excluded.result_title,updated_at=now()`,[user.id,PROFILE_TEST_VERSION,JSON.stringify(raw.testAnswers),result.title],`INSERT INTO profile_tests(user_id,test_version,answers,result_title) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET test_version=excluded.test_version,answers=excluded.answers,result_title=excluded.result_title,updated_at=CURRENT_TIMESTAMP`);
    }
    await client.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id)
       VALUES($1,'PROFILE_UPDATED','profile',$2)`,
      [user.id, user.id],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch {
    await client.query('ROLLBACK').catch(()=>{});
    return NextResponse.json({ error: '프로필을 저장하지 못했습니다.' }, { status: 500 });
  } finally {client.release();}
}
