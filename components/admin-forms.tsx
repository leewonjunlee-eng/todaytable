'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const areas = ['홍대/합정', '잠실', '강남/신논현', '을지로/종로'];
function Feedback({ text }: { text: string }) {
  return text ? <p className={text.includes('저장') ? 'success' : 'form-error'}>{text}</p> : null;
}

export function EventForm() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: values.get('title'),
          startsAt: new Date(`${String(values.get('startsAt'))}:00+09:00`).toISOString(),
          deadline: new Date(`${String(values.get('deadline'))}:00+09:00`).toISOString(),
          area: values.get('area'),
          capacity: Number(values.get('capacity')),
          price: 8000,
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? '회차를 저장했어요.' : result.error);
      if (response.ok) { form.reset(); router.refresh(); }
    } catch {
      setMessage('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>회차 이름<input name="title" required maxLength={120} placeholder="홍대 목요 저녁" /></label>
      <div className="form-grid">
        <label>모임 시작 (한국 시간)<input name="startsAt" type="datetime-local" required /></label>
        <label>신청 마감 (한국 시간)<input name="deadline" type="datetime-local" required /></label>
        <label>지역<select name="area">{areas.map((area) => <option key={area}>{area}</option>)}</select></label>
        <label>정원<input name="capacity" type="number" min="4" max="200" defaultValue="30" required /></label>
      </div>
      <p className="fineprint">기본 1회권 참가비 ₩8,000 · 식사 비용은 현장 별도 결제</p>
      <Feedback text={message} />
      <button className="button primary" disabled={busy}>{busy ? '저장 중…' : '회차 등록'}</button>
    </form>
  );
}

export function VenueForm() {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'), address: values.get('address'), area: values.get('area'),
          capacity: Number(values.get('capacity')),
        }),
      });
      const result = await response.json();
      setMessage(response.ok ? '식당을 저장했어요.' : result.error);
      if (response.ok) { form.reset(); router.refresh(); }
    } catch {
      setMessage('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <label>식당 이름<input name="name" required maxLength={120} /></label>
      <label>주소<input name="address" required maxLength={240} /></label>
      <div className="form-grid">
        <label>지역<select name="area">{areas.map((area) => <option key={area}>{area}</option>)}</select></label>
        <label>수용 인원<input name="capacity" type="number" min="4" max="300" defaultValue="24" required /></label>
      </div>
      <Feedback text={message} />
      <button className="button primary" disabled={busy}>{busy ? '저장 중…' : '식당 등록'}</button>
    </form>
  );
}
