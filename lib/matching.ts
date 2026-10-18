export type MatchCandidate = {
  applicationId: string; userId: string; birthYear: number; gender: string; mbti: string;
  interests: string[]; traits: string[]; desiredTraits: string[]; eventIds: string[]; paid: boolean; valid: boolean;
  atmosphere?: string; preferredInterests?: string[]; learnedInterests?: string[]; signalConfidence?: number;
  priorUserIds?: string[]; blockedUserIds?: string[]; eventTimes?: Record<string,{ startsAt:string; endsAt:string }>;
};
export type MatchGroup = { members: MatchCandidate[]; score: number; explanation: string; eventId?: string };
export type MatchResult = { groups: MatchGroup[]; unmatched: MatchCandidate[]; matchedCount: number; qualityScore: number };
export type MatchWeights = { gender: number; mbti: number; interests: number; traits: number; novelty: number };
const DEFAULT_WEIGHTS: MatchWeights = { gender: 0.4, mbti: 0.25, interests: 0.2, traits: 0.1, novelty: 0.05 };

const MAX_GROUPS = 1200;
const overlap = (a: string[], b: string[]) => { const set = new Set(a); return b.filter((v) => set.has(v)).length; };
export function shareEvent(group: MatchCandidate[], candidate?: MatchCandidate) {
  const all = candidate ? [...group, candidate] : group;
  if (!all.length) return undefined;
  return all.slice(1).reduce((ids, m) => ids.filter((id) => m.eventIds.includes(id)), all[0].eventIds).sort()[0];
}
function overlapsForSameUser(group: MatchCandidate[], candidate: MatchCandidate) {
  for(const prior of group) if(prior.userId===candidate.userId) {
    for(const a of prior.eventIds) for(const b of candidate.eventIds) {
      const x=prior.eventTimes?.[a]; const y=candidate.eventTimes?.[b];
      if(!x||!y) return true;
      if(new Date(x.startsAt).getTime()<new Date(y.endsAt).getTime()&&new Date(y.startsAt).getTime()<new Date(x.endsAt).getTime()) return true;
    }
  }
  return false;
}
/** This is an explicit product heuristic, not a scientific claim about MBTI. */
function mbtiHeuristic(a: string, b: string) { return a && b && a === b ? 1 : a && b ? 0.25 : 0.5; }
function genderPair(a: MatchCandidate, b: MatchCandidate) {
  const unknown = (g: string) => !g || g === 'PREFER_NOT_TO_SAY' || g === 'UNKNOWN';
  if (unknown(a.gender) || unknown(b.gender)) return 0.5;
  return a.gender === b.gender ? 0.25 : 1;
}
function pairScore(a: MatchCandidate, b: MatchCandidate, weights = DEFAULT_WEIGHTS) {
  const interest = overlap(a.interests, b.interests) / Math.max(1, Math.max(a.interests.length, b.interests.length));
  const trait = (overlap(a.desiredTraits, b.traits) + overlap(b.desiredTraits, a.traits)) / Math.max(1, a.desiredTraits.length + b.desiredTraits.length);
  const novelty = (a.priorUserIds ?? []).includes(b.userId) || (b.priorUserIds ?? []).includes(a.userId) ? 0 : 1;
  const atmosphere=a.atmosphere&&b.atmosphere&&a.atmosphere!=='BALANCED'&&b.atmosphere!=='BALANCED'?(a.atmosphere===b.atmosphere?1:.25):.5;
  const base=genderPair(a,b)*weights.gender+mbtiHeuristic(a.mbti,b.mbti)*weights.mbti+interest*weights.interests+trait*weights.traits+novelty*weights.novelty;
  const evidence=Math.min(1,Math.max(a.signalConfidence??0,b.signalConfidence??0));
  if(!evidence)return base;
  const preferred=(person:MatchCandidate,peer:MatchCandidate)=>{const interests=[...(person.preferredInterests??[]),...(person.learnedInterests??[])];return interests.length?overlap(interests,peer.interests)/Math.max(1,new Set(interests).size):.5;};
  const signal=(preferred(a,b)+preferred(b,a)+atmosphere)/3;
  const influence=.1*evidence;
  return base*(1-influence)+signal*influence;
}
function groupGenderBalance(group: MatchCandidate[]) {
  const known = group.filter((m) => m.gender && !['PREFER_NOT_TO_SAY', 'UNKNOWN'].includes(m.gender));
  if (known.length < 2) return 0.5;
  const counts = new Map<string, number>(); for (const m of known) counts.set(m.gender, (counts.get(m.gender) ?? 0) + 1);
  const largest = Math.max(...counts.values());
  return 1 - (largest - Math.ceil(known.length / counts.size)) / known.length;
}
export function groupScore(group: MatchCandidate[], weights = DEFAULT_WEIGHTS) {
  let total = 0; let pairs = 0;
  for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) { total += pairScore(group[i], group[j], weights); pairs += 1; }
  return pairs ? (total / pairs) * 0.85 + groupGenderBalance(group) * 0.15 : 0;
}
export function isHardCompatible(group: MatchCandidate[], candidate: MatchCandidate, minScore = 0, weights = DEFAULT_WEIGHTS) {
  if (!candidate.paid || !candidate.valid || group.some((m) => m.userId === candidate.userId)) return false;
  if (group.some((m) => (candidate.blockedUserIds ?? []).includes(m.userId) || (m.blockedUserIds ?? []).includes(candidate.userId))) return false;
  if (!shareEvent(group, candidate)) return false;
  if (group.length && Math.max(...group.map((m) => m.birthYear), candidate.birthYear) - Math.min(...group.map((m) => m.birthYear), candidate.birthYear) > 8) return false;
  // The minimum is a group-level quality floor, not merely the last pair.
  return group.length === 0 || (minScore <= 0 && Object.values(weights).every(weight => weight >= 0)) || groupScore([...group, candidate], weights) >= minScore;
}
export function preferredSize(n: number) {
  if (n < 4) return 0;
  if (n <= 6) return n;
  if (n === 7) return 6;
  if (n === 8) return 4;
  if (n === 9) return 5;
  if (n === 10) return 6;
  if (n === 11) return 6;
  // Avoid leaving seven people after taking a six-person table.
  return n % 6 === 1 ? 5 : 6;
}
/** Bounded deterministic search: maximize placements first, then whole-group quality. */
export function buildDeterministicGroups(candidates: MatchCandidate[], seed = 'v1', minScore = 0, weights: MatchWeights = DEFAULT_WEIGHTS, maxSeats = Number.POSITIVE_INFINITY) {
  const hash = (id: string) => { let h = 2166136261; for (const c of `${seed}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  const eligible = candidates.filter((c) => c.paid && c.valid).slice().sort((a, b) => hash(a.applicationId) - hash(b.applicationId) || a.applicationId.localeCompare(b.applicationId));
  const key = (group: MatchCandidate[]) => group.map((m) => m.applicationId).sort().join(',');
  let exploredNodes = 0;
  const nodeBudget = Number.isFinite(Number(process.env.MATCH_NODE_BUDGET)) ? Math.max(1000, Number(process.env.MATCH_NODE_BUDGET)) : 50000;
  const groupsFor = (pool: MatchCandidate[], size: number) => {
    const found: MatchCandidate[][] = [];
    const visit = (start: number, group: MatchCandidate[]) => {
      if (++exploredNodes > nodeBudget || found.length >= MAX_GROUPS) return;
      if (group.length === size) { found.push(group.slice()); return; }
      for (let i = start; i < pool.length; i += 1) {
        const next = pool[i];
        if (isHardCompatible(group, next, minScore, weights)) visit(i + 1, [...group, next]);
      }
    };
    visit(0, []);
    return found;
  };
  let bestGroups: MatchCandidate[][] = []; let bestCount = 0; let bestQuality = -1; let bestKey = '';
  const search = (pool: MatchCandidate[], chosen: MatchCandidate[][], quality: number) => {
    if (chosen.length >= MAX_GROUPS || exploredNodes++ >= nodeBudget) return;
    const count = chosen.reduce((n, g) => n + g.length, 0);
    const canonical = chosen.map(key).sort().join('|');
    if (count > bestCount || (count === bestCount && (quality > bestQuality || (quality === bestQuality && canonical < bestKey)))) {
      bestGroups = chosen.map((g) => g.slice()); bestCount = count; bestQuality = quality; bestKey = canonical;
    }
    if (pool.length < 4 || count + pool.length < bestCount) return;
    for (const size of [6, 5, 4]) {
      if (pool.length < size || count + size > maxSeats) continue;
      for (const group of groupsFor(pool, size)) {
        const ids = new Set(group.map((m) => m.applicationId));
        search(pool.filter((m) => !ids.has(m.applicationId) && !overlapsForSameUser(group,m)), [...chosen, group], quality + groupScore(group, weights));
      }
    }
  };
  if (eligible.length > 18) {
    // Large cohorts compare a bounded set of complete groups by quality.
    let pool = eligible.slice();
    while (pool.length >= 4 && maxSeats - bestGroups.reduce((n,g)=>n+g.length,0) >= 4) {
      const available=Math.min(pool.length,maxSeats-bestGroups.reduce((n,g)=>n+g.length,0));
      const size = preferredSize(available) || 4;
      let possibilities=groupsFor(pool,Math.min(size,pool.length));
      if(!possibilities.length)for(const fallback of [5,4])if(fallback<size){possibilities=groupsFor(pool,fallback);if(possibilities.length)break;}
      const group=possibilities.map(members=>({members,score:groupScore(members,weights),key:key(members)})).sort((a,b)=>b.score-a.score||a.key.localeCompare(b.key))[0]?.members;
      if (!group) break;
      bestGroups.push(group);
      const used = new Set(group.map((m) => m.applicationId));
      pool = pool.filter((m) => !used.has(m.applicationId) && !overlapsForSameUser(group,m));
    }
    bestCount = bestGroups.reduce((n, g) => n + g.length, 0);
  } else {
    search(eligible, [], 0);
  }
  const groups = bestGroups.map((members) => ({ members, score: Number(groupScore(members, weights).toFixed(6)), eventId: shareEvent(members), explanation: '결제·동의·공통 일정·연령 폭 8살·상호 제외를 통과했으며 성별 균형·MBTI·관심사·성향·새 만남을 고려했습니다.' }));
  const used = new Set(bestGroups.flat().map((m) => m.applicationId));
  return { groups, unmatched: eligible.filter((c) => !used.has(c.applicationId)), matchedCount: bestCount, qualityScore: Number(groups.reduce((n, g) => n + g.score, 0).toFixed(6)) };
}
