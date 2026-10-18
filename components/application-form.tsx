'use client';
import { useEffect, useState } from 'react';

type EventOption = {
  id: string; title: string; starts_at: string; application_deadline: string;
  is_demo:boolean; area: string; capacity: number; price_cents: number;
};
const passes = [
  { id: 'SINGLE', title: '1회권', price: '₩8,000', note: '한 번의 저녁' },
  { id: 'THREE_PASS', title: '3회권', price: '₩15,000', note: '2개월 이내 3회' },
  { id: 'EXISTING_PASS', title: '보유 이용권', price: '₩0', note: '기존 3회권 사용' },
];

export function ApplicationForm({initialEventId=''}:{initialEventId?:string}) {
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pass, setPass] = useState('SINGLE');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/events')
      .then(async (response) => {
        if (!response.ok) throw new Error('일정을 불러오지 못했습니다. 새로고침해 주세요.');
        return response.json();
      })
      .then((rows: EventOption[]) => { if (active && Array.isArray(rows)) {setEvents(rows);if(rows.some(r=>r.id===initialEventId))setSelectedIds([initialEventId]);} })
      .catch((reason: unknown) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : '일정을 불러오지 못했습니다.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialEventId]);

  function toggleEvent(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...current, id] : current.filter((value) => value !== id));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const response = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventIds: selectedIds, pass, requestKey }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? '신청을 저장하지 못했습니다.');
        return;
      }
      setSuccess(`신청이 저장되었어요 · 결제 ₩${Number(result.amount).toLocaleString()} · 번호 ${String(result.id).slice(0, 8)}`);
      setRequestKey(crypto.randomUUID());
      setSelectedIds([]);
    } catch {
      setError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <div className="section-heading"><span className="step-number">01</span><div><h2>참석할 수 있는 저녁</h2><p>일정을 여러 개 선택하면 가능한 날을 함께 알려드려요.</p></div></div>
      {loadError && <p className="form-error">{loadError}</p>}
      {loading ? <div className="empty-card">일정을 불러오는 중…</div> : events.length === 0
        ? <div className="empty-card">현재 신청 가능한 저녁이 없어요.</div>
        : <div className="event-grid">{events.map((option) => (
          <label className={`event-option ${selectedIds.includes(option.id) ? 'selected' : ''}`} key={option.id}>
            <input type="checkbox" checked={selectedIds.includes(option.id)} onChange={(event) => toggleEvent(option.id, event.target.checked)} />
            <span className="event-area">{option.area}</span>
            <strong>{new Date(option.starts_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' })}</strong>
            <small>{new Date(option.starts_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' })} · 최대 {option.capacity}명</small>
          </label>
        ))}</div>}
      <div className="section-heading top-gap"><span className="step-number">02</span><div><h2>참가권 선택</h2><p>식사 비용은 현장에서 각자 계산해요.</p></div></div>
      <div className="pass-grid">{passes.map((option) => (
        <label className={`pass-option ${pass === option.id ? 'selected' : ''}`} key={option.id}>
          <input type="radio" name="pass" checked={pass === option.id} onChange={() => setPass(option.id)} />
          <span>{option.title}</span><strong>{option.price}</strong><small>{option.note}</small>
        </label>
      ))}</div>
      <div className="notice"><strong>참가 전 확인해 주세요</strong><p>참가권은 만남 준비를 위한 이용권입니다. 식사 비용은 현장에서 각자 부담해요. 일정 변경과 취소는 신청 내역에서 확인할 수 있어요.</p></div>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <button className="button primary" disabled={busy || loading || !!loadError || events.length === 0}>
        {busy ? '신청 저장 중…' : '참가 신청 완료하기'} <span>→</span>
      </button>
    </form>
  );
}
