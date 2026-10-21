'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {formatKstDateTime} from '@/lib/date-format';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {UiIcon} from './ui-icon';
import {SiteNav} from './site-nav';

export type JourneyData = {
  applications?: any[];
  entitlements?: any[];
  notifications?: any[];
  recommendations?: any[];
  history?: any[];
};

export function safeError(body: any, fallback = '요청을 처리하지 못했어요.') {
  return typeof body?.error === 'string' ? body.error : fallback;
}

export class JourneyError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'JourneyError'; }
}

export async function journeyFetch(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new JourneyError(safeError(body), response.status);
  return body;
}

export function useJourney(path: string | null, interval?: number) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(false);
  const activePath = useRef(path);
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback((signal?: AbortSignal): Promise<void> => {
    if (!path || !mounted.current || activePath.current !== path) return Promise.resolve();
    if (inFlight.current) return inFlight.current;

    const request = (async () => {
      try {
        const next = await journeyFetch(path, { signal });
        if (!signal?.aborted && mounted.current && activePath.current === path) { setData(next); setError(''); setErrorStatus(null); }
      } catch (err) {
        if (signal?.aborted || !mounted.current || activePath.current !== path) return;
        setError(err instanceof Error ? err.message : '불러오지 못했어요.');
        setErrorStatus(err instanceof JourneyError ? err.status : null);
      } finally {
        if (!signal?.aborted && mounted.current && activePath.current === path) setLoading(false);
      }
    })();

    inFlight.current = request;
    request.then(
      () => { if (inFlight.current === request) inFlight.current = null; },
      () => { if (inFlight.current === request) inFlight.current = null; },
    );
    return request;
  }, [path]);

  const refresh = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    if (mounted.current) await load();
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    activePath.current = path;
    setLoading(Boolean(path));
    setData(null);
    if (!path) { setError(''); setErrorStatus(null); return () => { mounted.current = false; }; }
    const controller = new AbortController();
    void load(controller.signal);
    const timer = interval
      ? window.setInterval(() => { void load(controller.signal); }, interval)
      : undefined;
    return () => {
      mounted.current = false;
      controller.abort();
      inFlight.current = null;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [interval, load]);

  return { data, error, errorStatus, loading, refresh };
}

export function JourneyState({
  loading,
  error,
  errorStatus,
  data,
  empty,
  onRefresh,
  children,
}: {
  loading: boolean;
  error: string;
  errorStatus?: number | null;
  data?: unknown;
  empty?: boolean;
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const admin = pathname.startsWith('/admin');
  const needsLogin=errorStatus===401||(admin&&errorStatus===403);
  const returnPath=pathname+(typeof window==='undefined'?'':window.location.search);
  const loginHref=`${admin?'/admin/login':'/login'}?next=${encodeURIComponent(returnPath)}`;
  if (loading) return <div className="journey-state" role="status">불러오는 중이에요…</div>;
  if (error && data == null) {
    return (
      <div className="journey-state error-state" role="alert">
        <p>{error}</p>
        {needsLogin ? <Link className="button primary" href={loginHref}>로그인하고 계속하기</Link> : errorStatus === 404 ? <div className="button-row"><Link className="button primary" href={admin ? '/admin' : '/applications'}>{admin ? '운영 현황으로' : '내 만남으로'}</Link><Link className="button quiet" href={admin ? '/admin/applications' : '/'}>{admin ? '신청 현황 보기' : '처음으로'}</Link></div> : <button className="button quiet" type="button" onClick={onRefresh}>다시 시도</button>}
      </div>
    );
  }
  if (empty) return <div className="journey-state"><p>아직 표시할 내용이 없어요.</p></div>;
  return <>{error&&<div className="notice" role="alert"><p>최신 정보를 불러오지 못했어요. 기존 화면과 입력을 유지했어요. {error}</p>{needsLogin?<Link className="button primary" href={loginHref}>로그인하고 계속하기</Link>:<button className="button quiet" type="button" onClick={onRefresh}>다시 시도</button>}</div>}{children}</>;
}

export function JourneyLayout({
  title,
  eyebrow,
  description,
  children,
  back = '/',
  actions,
  loggedIn=true,
  focus=false,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  children: ReactNode;
  back?: string;
  actions?: ReactNode;
  loggedIn?: boolean;
  focus?: boolean;
}) {
  return (
    <>
      <SiteNav admin={Boolean(eyebrow?.startsWith('ADMIN'))} loggedIn={loggedIn} focus={focus} back={back} focusTitle={title}/>
      <main id="main-content" className={`page evolution-page ${eyebrow?.startsWith('ADMIN')?'admin-page':'participant-page'} ${focus?'focus-page':''}`}>
        {focus&&<Link className="back-link" href={back}>← 돌아가기</Link>}
        <div className="page-heading">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {children}
      </main>
    </>
  );
}

const statusLabels: Record<string, string> = {
  SUBMITTED:'신청 완료', PENDING:'결제 대기', MATCHING:'매칭 중', REALLOCATING:'다른 조합 확인 중', ALTERNATIVE_OFFERED:'다음 일정 선택 필요', NO_MATCH:'매칭 종료', EXCEPTION:'운영팀 확인 중', CANCELED:'신청 취소', REFUND_PROCESSING:'환불 처리 중', REFUND_FAILED:'환불 확인 필요',
  WAITING: '매칭 대기', MATCHED: '매칭 완료', CONFIRMED: '식탁 확정',
  TRANSFER: '다른 일정 선택', HOLD: '보류', REFUND: '환불 요청',
  PAID: '결제 완료', ATTENDED: '참석 완료', NO_SHOW_CANDIDATE: '노쇼 확인 대기',
  NO_SHOW: '노쇼 처리', OFFERED: '선택 필요', FAILED: '처리 실패',
  TRANSFERRED: '일정 변경 완료', REFUND_REQUESTED: '환불 요청', REFUNDED: '환불 완료',
};

export function StatusPill({ value }: { value?: string }) {
  return <span className="status-pill">{statusLabels[value || ''] || value || '상태 확인 중'}</span>;
}

export function RefreshButton({ onClick }: { onClick: () => Promise<void> }) {
  return <button className="button quiet compact" type="button" onClick={() => void onClick()}>새로고침</button>;
}

const moneyStatus: Record<string, string> = { PAID: '결제 완료', PENDING: '결제 대기', REFUNDED: '환불 완료', FAILED: '결제 실패', REFUND_AVAILABLE:'환불 선택 가능', REFUND_REQUESTED:'환불 요청', REFUND_PROCESSING:'환불 처리 중', REFUND_FAILED:'환불 확인 필요', CANCELED:'결제 취소' };

export function ApplicationCard({
  application,
  onResolution,
}: {
  application: any;
  onResolution?: (choice: 'TRANSFER' | 'HOLD' | 'REFUND', eventId?: string) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState('');
  const resolution = application.resolution;
  const canAct = resolution && resolution.selected_choice!=='REFUND' && ['OFFERED', 'FAILED'].includes(resolution.status);
  async function resolve(choice: 'TRANSFER' | 'HOLD' | 'REFUND') {
    if (!onResolution || saving) return;
    if (choice === 'TRANSFER' && !selectedEvent) return;
    setSaving(true);
    try { await onResolution(choice, choice === 'TRANSFER' ? selectedEvent : undefined); }
    finally { setSaving(false); }
  }
  return (
    <article className="panel application-card">
      <div className="section-title">
        <div>
          <div className="eyebrow">{application.created_at ? formatKstDateTime(application.created_at) : '신청'}</div>
          <h2>{application.events?.map((event: any) => event.title).join(' · ') || '신청한 식탁'}</h2>
        </div>
        <StatusPill value={application.matching_status || application.status} />
      </div>
      <p>{application.explanation || '신청 상태와 다음 안내를 확인해 주세요.'}</p>
      {application.payment_status && <p className="muted">{moneyStatus[application.payment_status] || '결제 상태 확인 중'} · ₩{Number(application.amount_cents || 0).toLocaleString()}</p>}{application.application_deadline && <p className="muted">다음 안내 예정: {formatKstDateTime(application.application_deadline)}까지</p>}
      {resolution && canAct && onResolution && (
        <div className="notice">
          <strong>{resolution.status === 'FAILED' ? '일정 변경을 다시 선택해 주세요' : '일정 조정이 필요해요'}</strong>
          <p>{resolution.reason || '확정된 일정에 변동이 생겼어요.'}</p>
          {resolution.alternatives?.length > 0 && (
            <fieldset className="resolution-options">
              <legend>원하는 대체 일정을 선택하세요</legend>
              {resolution.alternatives.map((option: any) => (
                <label key={option.event_id} className="option-card">
                  <input type="radio" name={`event-${application.id}`} value={option.event_id} checked={selectedEvent === option.event_id} onChange={() => setSelectedEvent(option.event_id)} />
                  <span><strong>{option.title || '대체 일정'}</strong><small>{option.area || '지역 미정'} · {option.starts_at ? formatKstDateTime(option.starts_at) : '시간 미정'}</small></span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="button-row">
            <button className="button quiet" type="button" disabled={saving} onClick={() => void resolve('HOLD')}>보류</button>
            <button className="button quiet" type="button" disabled={saving} onClick={() => void resolve('REFUND')}>환불 요청</button>
            {resolution.alternatives?.length > 0 && <button className="button primary" type="button" disabled={saving || !selectedEvent} onClick={() => void resolve('TRANSFER')}>선택한 일정으로 변경</button>}
          </div>
        </div>
      )}
      {application.table_id && <Link className="inline-link" href={`/tables/${application.table_id}`}>내 식탁 보기 →</Link>}

      <Link className="application-support-link" href={`/support?new=1&applicationId=${application.id}`}>이 신청에 대해 문의하기</Link><small className="mono">신청 번호 {application.id}</small>
    </article>
  );
}

export function AdminNav() {
  return (
    <nav className="admin-nav" aria-label="관리자 메뉴">
      <Link href="/admin">대시보드</Link><Link href="/admin/events">회차</Link><Link href="/admin/venues">장소</Link><Link href="/admin/applications">신청</Link>
      <Link href="/admin/exceptions">예외</Link><Link href="/admin/safety">안전</Link><Link href="/admin/operations">운영</Link><Link href="/admin/matching">매칭 규칙</Link>
      <Link href="/admin/attendance">참석</Link><Link href="/admin/notification">알림</Link><Link href="/admin/reservation">예약</Link>
    </nav>
  );
}

export function AdminAction({ id, action, children, onDone, className = 'button quiet', body = {}, confirmMessage }: { id: string; action: string; children: ReactNode; confirmMessage?: string; onDone?: () => Promise<void>; className?: string; body?: Record<string, unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    if (busy || (confirmMessage && !window.confirm(confirmMessage))) return;
    setBusy(true); setError('');
    try { await journeyFetch('/api/admin/journey', { method: 'POST', body: JSON.stringify({ action, id, ...body }) }); await onDone?.(); }
    catch (err) { setError(err instanceof Error ? err.message : '요청에 실패했어요.'); }
    finally { setBusy(false); }
  }
  return <span><button className={className} type="button" disabled={busy} onClick={() => void go()}>{busy ? '처리 중…' : children}</button>{error && <span className="form-notice" role="alert">{error}</span>}</span>;
}

export function ScoreField({ name, label }: { name: string; label: string }) {
  return <label>{label}<select name={name} required defaultValue=""><option value="" disabled>점수 선택</option>{[1, 2, 3, 4, 5].map(number => <option key={number} value={number}>{number}점</option>)}</select></label>;
}

export function FormNotice({ message }: { message: string }) { return message ? <p className="form-notice" role="alert">{message}</p> : null; }
export function useRequestKey() { const ref = useRef<string | undefined>(undefined); return { next: () => { if (!ref.current) ref.current = crypto.randomUUID(); return ref.current; }, reset: () => { ref.current = undefined; } }; }

export function ApplicationSummary({application}:{application:any}){
 const event=application.events?.[0];
 return <Link className="compact-row application-summary" href={`/applications/${application.id}`}>
  <span className="row-icon"><UiIcon name="table"/></span><span className="row-copy"><strong>{event?.title??'신청한 식탁'}</strong><small>{event?.area??'일정 확인'}{event?.starts_at?` · ${new Date(event.starts_at).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'})}`:''}</small><StatusPill value={application.matching_status||application.status}/></span><UiIcon name="chevron" size={17}/>
 </Link>;
}
