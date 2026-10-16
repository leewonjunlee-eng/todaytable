import { NextResponse } from 'next/server';
import { apiUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { DESIRED_TRAITS, FOOD_BUDGETS, INTERESTS, TRAITS } from '@/lib/domain';
import { sameOrigin } from '@/lib/http';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const result = await db.query(
    `SELECT display_name,contact_phone,birth_year,gender,occupation,mbti,interests,traits,
            desired_traits,food_budgets,dietary_notes,consent_privacy,consent_operations,consent_version
     FROM profiles WHERE user_id=$1`,
    [user.id],
  );
  return NextResponse.json(result.rows[0] ?? null);
}

export async function PUT(request: Request) {
  const user = await apiUser(request);
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: '요청 출처를 확인할 수 없습니다.' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const selections = [
      [body.interests, INTERESTS],
      [body.traits, TRAITS],
      [body.desiredTraits, DESIRED_TRAITS],
    ] as const;
    const currentKstYear = Number(new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Seoul', year: 'numeric',
    }).format(new Date()));
    const badSelections = selections.some(([values, allowed]) =>
      !Array.isArray(values) || values.length < 1 || values.length > 10
      || new Set(values).size !== values.length
      || values.some((value: unknown) => !allowed.includes(value as never)));
    const badFoodBudgets = !Array.isArray(body.foodBudgets)
      || body.foodBudgets.length < 1 || body.foodBudgets.length > 4
      || new Set(body.foodBudgets).size !== body.foodBudgets.length
      || body.foodBudgets.some((value: string) => !FOOD_BUDGETS.includes(value as never));
    const valid = typeof body.name === 'string' && !!body.name.trim() && body.name.length <= 80
      && typeof body.phone === 'string' && /^01[0-9]-?\d{3,4}-?\d{4}$/.test(body.phone)
      && Number.isInteger(body.birthYear) && body.birthYear >= 1920
      && body.birthYear <= currentKstYear - 19
      && ['WOMAN', 'MAN', 'NON_BINARY', 'PREFER_NOT_TO_SAY'].includes(body.gender)
      && typeof body.occupation === 'string' && !!body.occupation.trim() && body.occupation.length <= 120
      && typeof body.mbti === 'string' && /^[IE][NS][FT][JP]$/.test(body.mbti)
      && !badSelections && !badFoodBudgets
      && typeof body.dietaryNotes === 'string' && body.dietaryNotes.length <= 1000
      && body.privacy === true && body.operations === true;
    if (!valid) {
      return NextResponse.json({ error: '필수 항목과 동의를 확인해 주세요.' }, { status: 400 });
    }

    await db.query(
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
    await db.query(
      `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id)
       VALUES($1,'PROFILE_UPDATED','profile',$2)`,
      [user.id, user.id],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: '프로필을 저장하지 못했습니다.' }, { status: 500 });
  }
}
