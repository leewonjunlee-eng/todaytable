'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { AdminAction, AdminNav, FormNotice, JourneyLayout, JourneyState, journeyFetch, useJourney } from './journey-ui';

const labels: Record<string, string> = { amount_cents: '결제 금액', provider: '결제 방식', pass_choice: '참가권', kind: '유형', reason: '사유', status: '상태', created_at: '접수일', reporter_name: '신고자', target_name: '대상자', job_type: '작업', attempts: '시도 횟수', last_error: '최근 오류', message: '내용', channel: '채널', title: '제목', area: '지역', member_count: '멤버 수', table_id: '식탁 ID', user_id: '사용자 ID', display_name: '이름', attendance_status: '참석 상태', application_id: '신청 ID' };
function display(key: string, value: unknown) { if (key === 'amount_cents') return `₩${Number(value).toLocaleString('ko-KR')}`; if (key === 'provider' && value === 'MOCK') return '모의 결제'; if (key === 'pass_choice') return ({ SINGLE: '1회권', THREE_PASS: '3회권', EXISTING_PASS: '보유 이용권' } as Record<string,string>)[String(value)] || String(value);  if (key === 'created_at' && value) return new Date(String(value)).toLocaleString('ko-KR'); if (key === 'status' || key === 'attendance_status') return ({ PAID: '결제 완료', REFUNDED: '환불 완료', REFUND_REQUESTED: '환불 요청', REFUND_PROCESSING: '환불 처리 중', CONFIRMED: '확정', SCHEDULED: '참석 예정', OPEN: '진행 중', PENDING: '대기', DONE: '완료', FAILED: '실패', ATTENDED: '참석', NO_SHOW: '노쇼' } as Record<string, string>)[String(value)] || String(value ?? '-'); return String(value ?? '-'); }

function AdminTable({ title, rows, columns, action }: { title: string; rows: any[]; columns: string[]; action?: (row: any) => ReactNode }) { return <section className="panel admin-table"><h2>{title}</h2>{rows.length === 0 ? <p>표시할 데이터가 없어요.</p> : <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column}>{labels[column] || column}</th>)}{action && <th>작업</th>}</tr></thead><tbody>{rows.map((row: any, index: number) => <tr key={row.id || index}>{columns.map(column => <td key={column}>{display(column, row[column])}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody></table></div>}</section>; }

function ReportReview({ row, onDone }: { row: any; onDone: () => Promise<void> }) {
  const [decision, setDecision] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!decision || !note.trim() || !confirm || busy) return;
    setBusy(true);
    setError('');
    try {
      await journeyFetch('/api/admin/journey', {
        method: 'POST',
        body: JSON.stringify({ action: 'REVIEW_REPORT', id: row.id, decision, note: note.trim() }),
      });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-inline-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={`decision-${row.id}`}>조치</label>
      <select id={`decision-${row.id}`} value={decision} onChange={event => setDecision(event.target.value)} required>
        <option value="">조치 선택</option>
        <option value="warning">경고</option>
        <option value="suspend">일시 정지</option>
        <option value="permanent">영구 이용 제한</option>
        <option value="dismiss">기각</option>
      </select>
      <label><span className="sr-only">검토 메모</span><input value={note} onChange={event => setNote(event.target.value)} placeholder="검토 사유" required /></label>
      <label><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} required /> 수동 판단을 확인함</label>
      <button className="button quiet" disabled={busy}>{busy ? '처리 중…' : '결정 저장'}</button>
      <FormNotice message={error} />
    </form>
  );
}

export function AdminDashboardView({ section = 'dashboard' }: { section?: string }) {
  const q = useJourney('/api/admin/journey');
  const title = ({ dashboard: '운영 대시보드', exceptions: '예외 처리', safety: '안전 검토', operations: '운영 현황', attendance: '참석 현황', notification: '알림 현황', reservation: '예약 현황' } as Record<string, string>)[section] || '운영 대시보드';
  const key = section === 'exceptions' ? 'exceptions' : section === 'safety' ? 'reports' : section === 'attendance' ? 'attendance' : section === 'notification' ? 'notifications' : section === 'reservation' ? 'tables' : section === 'operations' ? 'jobs' : 'metrics';
  const rows = q.data?.[key] || [];
  const attendanceColumns = ['table_id', 'user_id', 'display_name', 'status'];

  return (
    <JourneyLayout title={title} eyebrow="ADMIN" description="신청·결제·식탁·예외 상태를 한눈에 확인합니다.">
      <div className="admin-shell">
        <AdminNav />
        {q.data?.demo && <div className="notice"><strong>모의 운영 중</strong><p>가상 참가자와 식당으로 운영 흐름을 체험합니다. 결제·환불은 모의 처리이며 실제 돈이 이동하지 않습니다.</p></div>}
        <JourneyState {...q} onRefresh={q.refresh} empty={!rows.length}>
          {section === 'dashboard' && <><section className="metrics">{(q.data?.metrics || []).map((metric: any) => <article className="metric" key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></article>)}</section><div className="export-row"><a className="button quiet" href="/api/admin/export?kind=applications">신청 CSV</a><a className="button quiet" href="/api/admin/export?kind=tables">식탁 CSV</a></div><AdminTable title="최근 결제 · 모의 거래" rows={q.data?.payments || []} columns={['display_name', 'title', 'pass_choice', 'amount_cents', 'status', 'created_at']} /><AdminTable title="운영 식탁" rows={q.data?.tables || []} columns={['title', 'area', 'status', 'member_count']} /></>}
          {section === 'exceptions' && <AdminTable title="처리가 필요한 예외" rows={rows} columns={['kind', 'reason', 'status', 'created_at']} action={(row: any) => <><AdminAction id={row.id} action="RESOLVE_EXCEPTION" body={{ status: 'RESOLVED', note: '관리자가 예외를 해결했습니다.' }} onDone={q.refresh}>해결</AdminAction><AdminAction id={row.id} action="RETRY_EXCEPTION" body={{ status: 'RETRY', note: '관리자가 재시도를 요청했습니다.' }} onDone={q.refresh}>재시도</AdminAction></>} />}
          {section === 'safety' && <AdminTable title="안전 신고" rows={rows} columns={['reason', 'status', 'reporter_name', 'target_name', 'created_at']} action={(row: any) => <ReportReview row={row} onDone={q.refresh} />} />}
          {section === 'attendance' && <AdminTable title="참석 확인" rows={rows} columns={attendanceColumns} action={(row: any) => <><AdminAction id={row.id || row.table_id + ':' + row.user_id} action="SET_ATTENDANCE" body={{ status: 'ATTENDED', note: '관리자가 참석을 확인했습니다.' }} onDone={q.refresh}>참석 확인</AdminAction><AdminAction id={row.id || row.table_id + ':' + row.user_id} action="SET_ATTENDANCE" body={{ status: 'NO_SHOW', note: '관리자가 노쇼를 확인했습니다.' }} onDone={q.refresh}>노쇼 처리</AdminAction></>} />}
          {section === 'operations' && <><AdminTable title="작업 상태" rows={rows} columns={['job_type', 'status', 'attempts', 'last_error']} /><AdminTable title="알림 전송" rows={q.data?.notifications || []} columns={['message', 'channel', 'status', 'created_at']} /></>}
          {(section === 'notification' || section === 'reservation') && <AdminTable title={title} rows={rows} columns={section === 'notification' ? ['message', 'channel', 'status', 'created_at'] : ['title', 'area', 'status', 'member_count']} />}
        </JourneyState>
      </div>
    </JourneyLayout>
  );
}

export function AdminMatchingView() {
  const q = useJourney('/api/admin/journey');
  const rules = useJourney('/api/admin/matching-rules');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await journeyFetch('/api/admin/matching-rules', { method: 'PUT', body: JSON.stringify({
        minScore: Number(form.get('minScore')),
        weights: Object.fromEntries(['gender', 'mbti', 'interests', 'traits', 'novelty'].map(key => [key, Number(form.get(key))])),
        version: String(form.get('version')),
      }) });
      setMessage('매칭 규칙을 저장했어요.');
      await rules.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '저장하지 못했어요.');
    } finally {
      setSaving(false);
    }
  }

  return <JourneyLayout title="매칭 규칙" eyebrow="ADMIN MATCHING"><JourneyState {...rules} onRefresh={rules.refresh}><form className="panel form-grid" onSubmit={save}><label>최소 점수<input name="minScore" type="number" min="0" max="1" step="0.01" defaultValue={rules.data?.minScore ?? 0} /></label>{['gender', 'mbti', 'interests', 'traits', 'novelty'].map(key => <label key={key}>{({ gender: '성별', mbti: 'MBTI', interests: '관심사', traits: '성향', novelty: '새 만남' } as Record<string, string>)[key]}<input name={key} type="number" min="0" max="1" step="0.01" defaultValue={rules.data?.weights?.[key] ?? 0} /></label>)}<label>버전<input name="version" required defaultValue={rules.data?.version ?? ''} /></label><button className="button primary" disabled={saving}>규칙 저장</button><FormNotice message={message} /></form><AdminTable title="현재 식탁" rows={q.data?.tables || []} columns={['title', 'area', 'status', 'member_count']} /></JourneyState></JourneyLayout>;
}