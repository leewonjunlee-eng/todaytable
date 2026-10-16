import { databaseProvider, db } from '../lib/db';
import { hashPassword } from '../lib/security';

async function ensureUser(email: string, password: string, role: 'ADMIN' | 'PARTICIPANT') {
  await db.query(
    `INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING`,
    [email, await hashPassword(password), role],
  );
  const result = await db.query('SELECT id FROM users WHERE email=$1', [email]);
  return result.rows[0].id as string;
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@todaytable.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'AdminDemo!2026';
  const participantEmail = process.env.SEED_PARTICIPANT_EMAIL ?? 'guest@todaytable.local';
  const participantPassword = process.env.SEED_PARTICIPANT_PASSWORD ?? 'GuestDemo!2026';
  if (process.env.NODE_ENV === 'production' && (!process.env.SEED_ADMIN_PASSWORD || !process.env.SEED_PARTICIPANT_PASSWORD)) {
    throw new Error('Set seed passwords explicitly in production.');
  }

  const adminId = await ensureUser(adminEmail, adminPassword, 'ADMIN');
  const participantId = await ensureUser(participantEmail, participantPassword, 'PARTICIPANT');
  await db.query(
    `INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,
      interests,traits,desired_traits,food_budgets,consent_privacy,consent_operations,consent_version,consented_at)
     VALUES($1,'게스트','010-0000-0000',1997,'PREFER_NOT_TO_SAY','기획자','INFP',
      ARRAY['음악','여행'],ARRAY['깊은 대화를 좋아함'],ARRAY['편하고 유머 있는 사람'],ARRAY['ANY'],
      true,true,'v1',now()) ON CONFLICT(user_id) DO NOTHING`,
    [participantId],
    `INSERT INTO profiles(user_id,display_name,contact_phone,birth_year,gender,occupation,mbti,
      interests,traits,desired_traits,food_budgets,consent_privacy,consent_operations,consent_version,consented_at)
     VALUES($1,'게스트','010-0000-0000',1997,'PREFER_NOT_TO_SAY','기획자','INFP',
      '["음악","여행"]','["깊은 대화를 좋아함"]','["편하고 유머 있는 사람"]','["ANY"]',
      1,1,'v1',CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO NOTHING`,
  );

  const eventCount = await db.query('SELECT 1 FROM events LIMIT 1');
  if (!eventCount.rowCount) {
    const areas = ['홍대/합정', '잠실', '강남/신논현', '을지로/종로'];
    const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [year, month, day] = todayKst.split('-').map(Number);
    const today = new Date(Date.UTC(year, month - 1, day));
    const thursdayOffset = (4 - today.getUTCDay() + 7) % 7 || 7;
    for (const [index, area] of areas.entries()) {
      const eventDate = new Date(today.getTime() + (thursdayOffset + index * 7) * 86400000);
      const startsAt = new Date(Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate(), 10, 30));
      const deadline = new Date(startsAt.getTime() - 36.5 * 60 * 60 * 1000);
      await db.query(
        `INSERT INTO events(title,starts_at,application_deadline,area,capacity,price_cents,created_by)
         VALUES($1,$2,$3,$4,30,8000,$5)`,
        [`${area} 목요 저녁`, startsAt, deadline, area, adminId],
      );
    }
  }

  const venueCount = await db.query('SELECT 1 FROM venues LIMIT 1');
  if (!venueCount.rowCount) {
    await db.query(
      `INSERT INTO venues(name,area,address,capacity)
       VALUES('테스트 다이닝','홍대/합정','서울 마포구 테스트로 1',24)`,
    );
  }
  await db.end();
  console.log(`Seeded demo users: ${adminEmail}, ${participantEmail}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
