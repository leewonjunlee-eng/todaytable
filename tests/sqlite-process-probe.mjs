const mode = process.argv[2];
const dbModule = await import('../lib/db.ts');
const db = dbModule.db ?? dbModule.default?.db;

try {
  let result;
  if (mode === 'submit') {
    const serviceModule = await import('../lib/application-service.ts');
    const submitApplication = serviceModule.submitApplication ?? serviceModule.default?.submitApplication;
    result = await submitApplication(process.env.PROBE_USER_ID, {
      eventIds: [process.env.PROBE_EVENT_ID],
      pass: 'SINGLE',
      requestKey: process.env.PROBE_REQUEST_KEY,
    });
  } else if (mode === 'read-profile') {
    const query = await db.query(
      'SELECT display_name FROM profiles WHERE user_id=$1',
      [process.env.PROBE_USER_ID],
    );
    result = query.rows[0] ?? null;
  } else {
    throw new Error(`Unknown probe mode: ${mode}`);
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.end();
}
