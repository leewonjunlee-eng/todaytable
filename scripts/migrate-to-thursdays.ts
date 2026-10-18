import { db, databaseProvider } from '../lib/db';

async function main() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    // 1. events 테이블: 모든 이벤트를 목요일 10:30 KST로 변경
    const todayKst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [year, month, day] = todayKst.split('-').map(Number);
    const today = new Date(Date.UTC(year, month - 1, day));
    const thursdayOffset = (4 - today.getUTCDay() + 7) % 7 || 7;
    const baseThursday = new Date(today.getTime() + thursdayOffset * 86400000);
    
    const events = await client.query('SELECT id, starts_at FROM events WHERE is_demo=true ORDER BY starts_at');
    
    for (let i = 0; i < events.rows.length; i++) {
      const event = events.rows[i];
      const newStart = new Date(baseThursday.getTime() + i * 7 * 86400000);
      const newStart1030 = new Date(Date.UTC(newStart.getUTCFullYear(), newStart.getUTCMonth(), newStart.getUTCDate(), 10, 30));
      const newEnd = new Date(newStart1030.getTime() + 2 * 60 * 60 * 1000);
      const newDeadline = new Date(newStart1030.getTime() - 36.5 * 60 * 60 * 1000);
      
      await client.query(
        'UPDATE events SET starts_at=$1, ends_at=$2, application_deadline=$3 WHERE id=$4',
        [newStart1030, newEnd, newDeadline, event.id]
      );
    }
    console.log(`Updated ${events.rows.length} events to Thursdays`);
    
    // 2. scheduled_jobs run_at 업데이트 (SQLite 호환)
    for (const event of events.rows) {
      const newStart = new Date(baseThursday.getTime() + events.rows.indexOf(event) * 7 * 86400000);
      const newStart1030 = new Date(Date.UTC(newStart.getUTCFullYear(), newStart.getUTCMonth(), newStart.getUTCDate(), 10, 30));
      const newDeadline = new Date(newStart1030.getTime() - 36.5 * 60 * 60 * 1000);
      
      await client.query(
        "UPDATE scheduled_jobs SET run_at=$1 WHERE json_extract(payload,'$.eventId')=$2",
        [newDeadline, event.id]
      );
    }
    console.log('Updated scheduled_jobs run_at');
    
    await client.query('COMMIT');
    console.log('Migration to Thursdays completed');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
