#!/usr/bin/env npx tsx
/**
 * Import all rows from files/우연한식탁_가상데이터.xlsx (provided-data-import.json)
 * into the application database, excluding the synthetic seed data.
 * - Fills blank contact_phone with synthetic Korean numbers
 * - Sets varied payment statuses across records
 * - Assigns applications to existing Thursday events cyclically
 */
import { db, databaseProvider } from '../lib/db';
import { hashPassword } from '../lib/security';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

function id(key: string): string {
  const { createHash } = require('node:crypto');
  const h = createHash('sha256').update(`provided-import:${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

function parseList(str: string | undefined): string[] {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function detectThreePass(passChoice: string): boolean {
  // Check for various forms of 3회권 / 4회권
  return passChoice.includes('3회권') || passChoice.includes('4회권') || passChoice.includes('회권');
}

async function main() {
  const payload = JSON.parse(readFileSync('.data/provided-data-import.json', 'utf-8'));
  const records = payload.records as any[];
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    if (databaseProvider === 'postgres') {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:provided-import', 0))");
    }

    // 기존 seed 이벤트 가져오기 (목요일 이벤트)
    const eventsRes = await client.query(
      `SELECT id, starts_at, application_deadline FROM events WHERE is_demo=true ORDER BY starts_at`
    );
    const events = eventsRes.rows as { id: string; starts_at: Date; application_deadline: Date }[];
    console.log(`Found ${events.length} demo events`);

    const adminRes = await client.query("SELECT id FROM users WHERE role='ADMIN' LIMIT 1");
    const adminId = adminRes.rows[0].id;

    let userCount = 0, appCount = 0, payCount = 0;
    const usedPhones = new Set<string>();
    const paymentStatuses = ['PAID', 'PAID', 'PAID', 'REFUNDED', 'FAILED', 'PAID', 'REFUNDED', 'PAID', 'PAID'];

    // Pre-extract all unique survey dates to assign events cyclically
    const allDates = new Set<string>();
    for (const rec of records) {
      const dates = (rec.fields.dates || '').split(',').map((d: string) => d.trim()).filter(Boolean);
      for (const d of dates) allDates.add(d);
    }
    console.log(`Found ${allDates.size} unique survey dates:`, Array.from(allDates).slice(0, 20));

    // Map each unique survey date to an event (cyclically)
    const dateToEvent = new Map<string, string>();
    const eventIds = events.map(e => e.id);
    let evIdx = 0;
    for (const dateStr of allDates) {
      dateToEvent.set(dateStr, eventIds[evIdx % eventIds.length]);
      evIdx++;
    }

    for (const rec of records) {
      const { fields, issues } = rec;

      // 이메일 생성 (가명 기반)
      const name = fields.name || '익명';
      const email = `${name.replace(/[^가-힣a-zA-Z0-9]/g, '')}${userCount}@demo.todaytable.io`;
      const passwordHash = await hashPassword(randomUUID());

      const userId = id(`provided:${userCount}`);

      try {
        await client.query(
          `INSERT INTO users(id, email, password_hash, role, is_demo)
           VALUES($1, $2, $3, 'PARTICIPANT', TRUE)`,
          [userId, email, passwordHash]
        );
      } catch (e: any) {
        if (!e.message?.includes('UNIQUE') && !e.message?.includes('constraint')) throw e;
        console.log(`  ⚠️ User already exists: ${userId}`);
      }

      userCount++;

      // 핸드폰 번호 (빈 경우 무작위 생성)
      let phone = fields.contact_phone || '';
      if (!phone) {
        while (true) {
          phone = `010-${String(Math.floor(Math.random()*10000)).padStart(4,'0')}-${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
          if (!usedPhones.has(phone)) { usedPhones.add(phone); break; }
        }
      }

      // MBTI 정규화
      let mbti = fields.mbti?.trim().toUpperCase() || '';
      const known = ['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP',
                     'ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'];
      mbti = mbti.replace(/\s+/g, '');
      if (!known.includes(mbti)) {
        const fixed = mbti.replace(/[^A-Z]/g, '');
        if (known.includes(fixed)) mbti = fixed;
        else if (fields.mbti && fields.mbti !== 'ISTP인데 다 반반이네요..' && fields.mbti !== 'wNTJ' && fields.mbti !== 'ESFJ ENTJ') {
          const trimmed = fields.mbti.replace(/[^A-Za-z]/g,'').toUpperCase().slice(0,4);
          if (known.includes(trimmed)) mbti = trimmed;
          else mbti = 'INFP';
        } else mbti = 'INFP';
      }

      // Profile
      const birthYear = fields.age ? 2026 - parseInt(fields.age, 10) : 1997;
      await client.query(
        `INSERT INTO profiles(user_id, display_name, contact_phone, birth_year, gender, occupation, mbti,
          interests, traits, desired_traits, food_budgets, consent_privacy, consent_operations,
          consent_version, consented_at, dietary_notes)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, true, 'v1', now(), $12)
         ON CONFLICT(user_id) DO UPDATE SET contact_phone=$3, display_name=$2, occupation=$6,
           interests=$8, traits=$9, desired_traits=$10, food_budgets=$11, dietary_notes=$12`,
        [
          userId, name, phone, birthYear,
          fields.gender === '여' ? 'WOMAN' : fields.gender === '남' ? 'MAN' : 'PREFER_NOT_TO_SAY',
          fields.occupation || '무직', mbti,
          parseList(fields.interests), parseList(fields.traits),
          parseList(fields.desired_traits), parseList(fields.food_budgets),
          fields.dietary_notes || ''
        ]
      );

      // Applications - one per preferred date, mapped to existing events cyclically
      const dates = fields.dates || '';
      const dateArr = dates.split(',').map((d: string) => d.trim()).filter(Boolean);
      for (let di = 0; di < dateArr.length; di++) {
        const dateStr = dateArr[di];
        const eventId = dateToEvent.get(dateStr);
        if (!eventId) {
          console.log(`  ⚠️ No event mapping for date: ${dateStr} (user: ${name})`);
          continue;
        }

        const passChoice = fields.pass_choice || '1회권: ₩8,000';
        const isThreePass = detectThreePass(passChoice);
        const amount = isThreePass ? 15000 : 8000;
        const uses = isThreePass ? 3 : 1;
        const appId = id(`app:provided:${userCount}:${di}`);
        const payId = id(`pay:provided:${userCount}:${di}`);
        const grantId = id(`grant:provided:${userCount}:${di}`);

        // Payment status varies
        const payStatus = paymentStatuses[appCount % paymentStatuses.length];

        await client.query(
          `INSERT INTO applications(id, user_id, request_key, pass_choice, pass_uses, amount_cents, created_at, is_demo)
           VALUES($1, $2, $3, $4, $5, $6, now(), TRUE)`,
          [appId, userId, id(`req:provided:${userCount}:${di}`), isThreePass ? 'THREE_PASS' : 'SINGLE', uses, amount]
        );

        await client.query('INSERT INTO application_options(application_id, event_id) VALUES($1, $2)', [appId, eventId]);

        await client.query(
          `INSERT INTO payments(id, application_id, idempotency_key, status, amount_cents, provider, created_at)
           VALUES($1, $2, $3, $4, $5, 'MOCK', now())`,
          [payId, appId, `mock-payment:${payId}`, payStatus, amount]
        );
        payCount++;

        if (payStatus === 'PAID') {
          await client.query(
            `INSERT INTO entitlements(id, user_id, source_payment_id, original_uses, remaining_uses, expires_at)
             VALUES($1, $2, $3, $4, $5, NULL)`,
            [grantId, userId, payId, uses, uses]
          );
        }

        // 알림
        await client.query(
          `INSERT INTO notifications(event_id, recipient_user_id, message, channel, status, sent_by, created_at)
           VALUES($1, $2, $3, 'IN_APP', 'SENT', $4, now())`,
          [eventId, userId, `참가 신청과 ${amount.toLocaleString('ko-KR')}원 결제가 완료되었어요.`, adminId]
        );

        appCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Imported: ${userCount} users, ${appCount} applications, ${payCount} payments`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Failed:', e);
    throw e;
  } finally {
    client.release();
    await db.end();
  }
}

main();