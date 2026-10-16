'use client';
import { useEffect, useState } from 'react';
import { DESIRED_TRAITS, FOOD_BUDGETS, INTERESTS, TRAITS } from '@/lib/domain';

type Profile = {
  name: string; phone: string; birthYear: string; gender: string; occupation: string; mbti: string;
  interests: string[]; traits: string[]; desiredTraits: string[]; foodBudgets: string[];
  dietaryNotes: string; privacy: boolean; operations: boolean;
};
const blank: Profile = {
  name: '', phone: '', birthYear: '', gender: 'PREFER_NOT_TO_SAY', occupation: '', mbti: '',
  interests: [], traits: [], desiredTraits: [], foodBudgets: ['ANY'], dietaryNotes: '',
  privacy: false, operations: false,
};
const foodBudgetLabels: Record<(typeof FOOD_BUDGETS)[number], string> = {
  UNDER_20000: '1~2만원',
  '20000_30000': '2~3만원',
  OVER_30000: '3만원 이상',
  ANY: '상관없음',
};

function Checks({
  title, values, selected, onChange,
}: {
  title: string; values: readonly string[]; selected: string[]; onChange: (values: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="chip-grid">
        {values.map((value) => (
          <label className={`choice-chip ${selected.includes(value) ? 'selected' : ''}`} key={value}>
            <input type="checkbox" checked={selected.includes(value)} onChange={(event) => onChange(
              event.target.checked ? [...selected, value] : selected.filter((item) => item !== value),
            )} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile>(blank);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/profile')
      .then(async (response) => {
        if (!response.ok) throw new Error('프로필을 불러오지 못했습니다. 새로고침해 주세요.');
        return response.json();
      })
      .then((data) => {
        if (!active || !data) return;
        setProfile({
          ...blank, name: data.display_name, phone: data.contact_phone,
          birthYear: String(data.birth_year), gender: data.gender, occupation: data.occupation,
          mbti: data.mbti, interests: data.interests ?? [], traits: data.traits ?? [],
          desiredTraits: data.desired_traits ?? [], foodBudgets: data.food_budgets ?? [],
          dietaryNotes: data.dietary_notes ?? '', privacy: data.consent_privacy,
          operations: data.consent_operations,
        });
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : '프로필을 불러오지 못했습니다.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...profile, birthYear: Number(profile.birthYear) }),
      });
      const result = await response.json();
      setMessage(response.ok ? '프로필을 저장했어요.' : result.error);
    } catch {
      setMessage('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const maxBirthYear = Number(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul', year: 'numeric',
  }).format(new Date())) - 19;

  return (
    <form className="form-stack profile-form" onSubmit={save}>
      {loadError && <p className="form-error">{loadError}</p>}
      <div className="form-grid">
        <label>이름<input required maxLength={80} value={profile.name} onChange={(e) => update('name', e.target.value)} /></label>
        <label>연락처<input required type="tel" placeholder="010-1234-5678" value={profile.phone} onChange={(e) => update('phone', e.target.value)} /></label>
        <label>출생연도<input required type="number" min="1920" max={maxBirthYear} value={profile.birthYear} onChange={(e) => update('birthYear', e.target.value)} /></label>
        <label>성별<select value={profile.gender} onChange={(e) => update('gender', e.target.value)}><option value="PREFER_NOT_TO_SAY">선택 안 함</option><option value="WOMAN">여성</option><option value="MAN">남성</option><option value="NON_BINARY">논바이너리</option></select></label>
        <label>직업<input required maxLength={120} value={profile.occupation} onChange={(e) => update('occupation', e.target.value)} /></label>
        <label>MBTI<input required placeholder="예: INFP" maxLength={4} value={profile.mbti} onChange={(e) => update('mbti', e.target.value.toUpperCase())} /></label>
      </div>
      <fieldset>
        <legend>식사 예산 (복수 선택)</legend>
        <div className="chip-grid">
          {FOOD_BUDGETS.map((id) => (
            <label className={`choice-chip ${profile.foodBudgets.includes(id) ? 'selected' : ''}`} key={id}>
              <input type="checkbox" checked={profile.foodBudgets.includes(id)} onChange={(event) => update(
                'foodBudgets', event.target.checked
                  ? [...profile.foodBudgets, id]
                  : profile.foodBudgets.filter((value) => value !== id),
              )} />
              {foodBudgetLabels[id]}
            </label>
          ))}
        </div>
      </fieldset>
      <Checks title="요즘 관심사" values={INTERESTS} selected={profile.interests} onChange={(values) => update('interests', values)} />
      <Checks title="나의 성향" values={TRAITS} selected={profile.traits} onChange={(values) => update('traits', values)} />
      <Checks title="만나고 싶은 사람" values={DESIRED_TRAITS} selected={profile.desiredTraits} onChange={(values) => update('desiredTraits', values)} />
      <label>못 먹는 음식이나 알레르기<textarea maxLength={1000} placeholder="없다면 비워두세요" value={profile.dietaryNotes} onChange={(e) => update('dietaryNotes', e.target.value)} /></label>
      <div className="consents">
        <label><input type="checkbox" checked={profile.privacy} onChange={(e) => update('privacy', e.target.checked)} /> 개인정보 수집 및 이용에 동의합니다. <em>(필수)</em></label>
        <label><input type="checkbox" checked={profile.operations} onChange={(e) => update('operations', e.target.checked)} /> 행사 운영 및 안내를 위한 이용에 동의합니다. <em>(필수)</em></label>
        <small>프로필 정보는 저녁 모임을 준비하고 참가자에게 필요한 안내를 제공하는 데 사용합니다.</small>
      </div>
      {message && <p className={message.includes('저장') ? 'success' : 'form-error'}>{message}</p>}
      <button className="button primary" disabled={busy || loading || !!loadError}>
        {loading ? '프로필 불러오는 중…' : busy ? '저장 중…' : '프로필 저장'} <span>→</span>
      </button>
    </form>
  );
}
