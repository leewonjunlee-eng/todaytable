# Claude Opus 5.5 교차 검토 원문

2026-10-19. 주 검토 모델 `claude-opus-5-5`. 각 회차는 그때 읽은 작업 트리의 정적 검토이며, 뒤 회차에서 수정한 내용을 앞 회차의 미수정 결함으로 해석하지 않는다. 실행 검증은 Codex가 수행했다. 최종 구현·실행 결과·정책 판단은 [통합 보고서](CROSS_REVIEW_20261019.md)를 기준으로 한다. CLI 응답·메타데이터 원본은 Git 제외 `.data/cross-review/`에 보관한다.

---

## 1차 검토

I found 3 high and 10 medium issues. The worst: a participant who leaves gender at the default "선택 안 함" can pay but will never be matched. This was a static review only, without a live browser test. Port 3000 is running a different project (`personal-assets/frontend`), and starting this app or running its tests would write `.next/` and the database, which wasn't allowed here. I ran Opus 5.5 (`claude-opus-5-5`) as requested, made no edits or deploys, and read no secrets. The full write-up is in `/home/ubuntu/.claude/plans/independently-audit-this-todaytable-eventual-catmull.md`.

## High
1. **Default-gender participants are charged but can never be matched.** "선택 안 함" is the default in `components/profile-test.tsx:11` and `components/profile-form.tsx:13`. `lib/matching.ts:78-83` requires every member to be MAN or WOMAN, and nothing at apply or checkout checks gender (`lib/application-service.ts:36`). They always end up ALTERNATIVE_OFFERED. **Fix:** require gender, or warn before payment. Also note the PRD treats gender balance (성비) as a preference, not a hard rule.
2. **The home screen doesn't show states that need action.** `components/meeting-experience.tsx:15` only treats WAITING, MATCHING and REALLOCATING as pending. A participant who must pick an alternative date, or has a pending payment or refund, sees nothing on home. If `/api/journey` fails, home just hides the status with no error. This misses the PRD rule that home shows status and next actions (PRD §16, STA-05). **Fix:** add cards driven by `alternativeCount` (already returned at `app/api/journey/route.ts:42`) and by payment and refund states.
3. **Operators can't reach the exceptions list.** When a background job fails for good, its exception is stored under the job's key (`worker/index.ts:300-305`). The table-detail page only shows exceptions for that table or event (`lib/operator-table.ts:13`). The real list with resolve and retry buttons (`components/admin-journey.tsx:68`) can't be reached, because `/admin/exceptions` redirects to `/admin/matching/review`. The dashboard counts these exceptions but links to the wrong page. This breaks MAT-13 and the required exceptions inbox (예외 처리함). **Fix:** restore the inbox route and point the dashboard count at it.

## Medium
4. **Dashboard buries what needs attention.** The "지금 확인할 운영 상황" block is collapsed below the charts (`components/operations-analytics.tsx:21`). It also lacks two PRD §11 counts: tables with no restaurant, and same-day cancel/no-show candidates.
5. **Participants see raw status codes.** The label maps in `components/journey-ui.tsx:144-160` miss about 10 states (ALTERNATIVE_OFFERED, REFUND_FAILED, …), so participants see raw English enums or "결제 상태 확인 중". Reuse the labels in `components/journey-pages.tsx:26-27`.
6. **Reporting is hard to find before the meal.** The report/block form is linked only once the event has ended and the user is checked in (`components/journey-pages.tsx:52`, `app/api/tables/[id]/route.ts:21`). There's no in-app way to report chat harassment before the meal.
7. **Forgetting to check in blocks feedback.** Check-in only works from 30 minutes before start to the end (`app/api/tables/[id]/check-in/route.ts:16`), and feedback requires a check-in. Someone who attended but forgot to check in can never mark "다시 만나고 싶지 않은 사람" (FDB-04).
8. **Refund and hold are one tap with no confirmation** (`components/journey-pages.tsx:23`).
9. **A brief network error during polling replaces the whole screen with an error** (chat, resolution and chats screens; `components/journey-ui.tsx:96`). Keep the existing data and show a banner instead.
10. **Cancel uses the earliest date option.** For an unmatched application with several dates, `app/api/applications/[id]/cancel/route.ts:21` uses the earliest one. If that day is today, cancel is blocked even though later dates are still open.
11. **One matching path ignores the PRD §7.4 relocation order.** `shareEvent` (`lib/matching.ts:18`) picks the event with the smallest ID instead of preferring the same date and area.
12. **Some PRD operator screens aren't in the menu.** Attendance management, message history and the exceptions inbox are missing from the sidebar (`components/site-nav.tsx:7-8`), and several admin pages are now just redirects.
13. **Text contrast fails WCAG AA (4.5:1)** (`app/globals.css:2`):
    - muted `#82766a` on cream: 3.99
    - terracotta `#be765a` links: 3.48
    - `#958575`: 3.51
    - table headers `#8e7e6d`: 3.86

    The refund-policy notice and table cells also use 9–11px text.

## Uncommitted changes
- **Shared selection check:** the new `lib/recruitment-selection.ts` is now used by the form, checkout and registration, so all three agree. Checkout is now stricter: every chosen date and area must have an event. That's correct, but it changes behaviour.
- **Application form:** the guard against reusing an expired checkout and the prefill fix both look right. One gap remains: areas not offered on the chosen dates can still be selected, and the user only finds out from a warning afterwards.
- **Operator reconfigure:** the assignment clamp fixes the old mismatch. If you merge more tables than the new table count, extra members are silently moved into the last table; worth showing that in the summary.
- **Login form:** adding `role="alert"` to the error is good.

## Scores (1–5)

| Area | Score | Main reason |
|---|---|---|
| PRD compliance | 3.5 | Core automation is in place; gender rule, exceptions inbox and dashboard items fall short |
| Participant UX | 3 | Clean flow, but home misses action states and some labels are raw codes |
| Operator UX | 2.5 | Exceptions are buried or unreachable |
| Accessibility | 3 | Basics are present; contrast and small text fail |
| Reliability | 3.5 | Locks, idempotency and retries are solid; failures aren't visible to operators |

**Uncertainties:** no live browser or screen-reader pass. I didn't run the tests; `docs/STATUS.md` says 92 pass, but I didn't re-check. The no-show and refund-failure paths were judged from code, not run. Next step: start this app on a free port and run Playwright journeys at 360/390/1440px for the gender, alternative-date and exceptions cases, plus axe-core and `npm test`.

---

## 2차 검토

I confirmed 10 of your claims. I found two dangerous bugs, one of them new, plus a likely test regression, so Reliability goes down rather than up. This turn ran on Opus 5.5 (`claude-opus-5-5`), as you asked. It was read-only, with no tests, edits, deploys, mutations or secrets. Everything below comes from reading the changed code directly.

## Claims confirmed
- **Gender gate before charging:** `lib/application-service.ts:67` rejects unknown gender before any payment row is written (lines 108–135). The `/api/availability` GET (`app/api/availability/route.ts:11-12`) and `components/application-form.tsx` explain it ahead of time. `tests/prd-completion.test.ts:32-34` checks that no payment is created. The hard 2/2–4/2 gender policy is unchanged.
- **Home:** alternative-choice and payment cards, a retry button for `/api/journey` errors, and a 15s poll (`components/meeting-experience.tsx:15,17`).
- **Refresh errors:** `JourneyState` now keeps the existing screen and shows an inline banner when a refresh fails (`components/journey-ui.tsx:~96-108`). Callers spread `{...q}`, so `data` is passed through.
- **Labels:** status and payment labels are expanded (`journey-ui.tsx:~150,163`).
- **Confirmations:** refund and hold now ask first (`components/journey-pages.tsx:22`), as do exception resolve and the new cancellation.
- **Safety:** the report/block form is on the table page before the meal, and the chat has a "신고·차단" link (`journey-pages.tsx:40,47`).
- **Exceptions inbox:** `/admin/exceptions` renders `OperatorExceptions`, the query puts unresolved rows first (`app/api/admin/journey/route.ts:15`), and the dashboard links to it with the panel open by default.
- **Contrast:** the muted color is now 5.38:1 and terracotta 5.40:1 (4.96:1 on cream), and `#958575`/`#8e7e6d` are gone.
- **Booking editor:** in-progress drafts and their version are kept, and saving is blocked when the data is stale.
- **Merge control:** reconfigure now uses the actual table count.

## Remaining defects
1. **HIGH, money: a failed refund can be refunded and also compensated another way.** When a refund job fails for good, the worker marks the refund request FAILED and the resolution FAILED (`worker/index.ts:306-311`). The payment stays REFUND_REQUESTED.
   - The participant UI still treats FAILED as choosable (`journey-pages.tsx:22-24`, `journey-ui.tsx` `canAct`), and `resolveApplication` accepts FAILED (`lib/lifecycle-service.ts:307`).
   - So a participant can then pick HOLD, which restores a pass (lines 331-334), or TRANSFER, which moves them to a new date.
   - Meanwhile the new "자동 작업 다시 시도" button resets the refund job (`app/api/admin/journey/route.ts:63-65`). `completeVirtualRefund` only checks the refund request and payment status (`lib/virtual-transactions.ts:7-10`). It then refunds the money and sets the application to CANCELED (`virtual-transactions.ts:20`).
   - The result is a refund plus a restored pass, or a transferred participant whose application gets cancelled.
   - **Fix:** once REFUND has been selected, `resolveApplication` should reject other choices. `completeVirtualRefund` should require `selected_choice='REFUND'` and a resolution status of REFUND_REQUESTED or FAILED.
   - The participant half of this existed before. The operator retry button makes it newly reachable.
2. **MEDIUM: retried exceptions never close.** The status is set to RETRYING (`route.ts:62`), and no code ever sets it back.
   - If the retry succeeds, the row stays in the inbox and in `openExceptions` with its retry button disabled (`components/operator-exceptions.tsx:22`).
   - If the retry fails, `worker/index.ts:301` inserts a new row, so the inbox shows duplicates.
   - **Fix:** in the worker, when the job completes, resolve the exception linked to that `job_key`, or reopen it if the job fails again.
3. **MEDIUM, test regression (predicted, not run):** the `tests/*.test.ts` glob includes `tests/sqlite.integration.test.ts`. That file has a PREFER_NOT_TO_SAY participant (line 65) whose applications are expected to succeed (lines 143-160, 183). The new gate should now reject them. The Postgres fixtures (`tests/postgres.integration.test.ts:102-117`) have the same problem but are skipped without a database. The 87-passing baseline therefore probably won't hold. **Fix:** change those fixtures to MAN/WOMAN.
4. **MEDIUM: cancellation date for unmatched applications.** The cancel UI (`journey-pages.tsx:24`) and the API (`app/api/applications/[id]/cancel/route.ts:21`) both use the earliest option, including past dates. An unmatched participant whose first option was today or has passed is blocked, even though later options are still open. My earlier finding #10 is still unfixed, and the new UI matches the server's behaviour.
5. **MEDIUM, policy gap:** while a paid application is still WAITING, the profile can be changed to "선택 안 함". The profile guard (`app/api/profile/route.ts:45-51`) only checks confirmed tables. That participant is then silently unmatchable until the cutoff. **Fix:** block the change, or warn, when the user has a submitted unmatched application.
6. **LOW:**
   - Some low-contrast text colors remain: `#948574`, and `#9c8975` on 10px brand text.
   - The check-in/feedback gate (old #7) is unchanged.
   - The "환불 처리 실패" link still goes to `/admin/inbox` instead of `/admin/exceptions`.

## Intentional scope, not defects
- Keeping six primary admin menu items, with 자동 처리 확인 and the other settings under the collapsed "설정과 관리" menu.
- Keeping the hard gender composition rule, as documented in `docs/GENDER_MATCHING_FIX_20261019.md`.
- Attendance and message history living inside context pages.

## Re-scored
| Category | Before | Now | Why |
|---|---|---|---|
| PRD compliance | 3.5 | 4 | Exceptions inbox, home actions, pre-meal safety, charge-before-match gate |
| Participant UX | 3 | 3.5 | Clear eligibility, action cards, labels, confirmations, cancellation. Unmatched cancel edge case remains |
| Operator UX | 2.5 | 3 | Inbox exists and the dashboard links to it. RETRYING rows stick, it sits in a collapsed menu, refund-failure link is wrong |
| Accessibility | 3 | 3.5 | Main color tokens pass AA, alerts kept. A few colors and small text remain. No screen-reader run |
| Reliability | 3.5 | 3 | Lowered: retry exposes the refund double-compensation race, exception states leak, fixture regression likely |

These scores don't count your in-progress targeted suite or production browser checks. Finding 3 is a code-reading prediction until the suite is re-run.

---

## 3차 검토

I confirmed every money/retry fix you listed in the code, but one HIGH bug remains. It's a pass-plus-refund path through the cancel endpoint that the latest changes only hide in the UI. This was a read-only code review on Opus 5.5 (`claude-opus-5-5`); I made no edits, mutations, deploys or secret access, and wrote no plan.

## Remaining HIGH: cancel endpoint can restore a pass while a refund is still due
The new guard is in the UI only (`components/application-cancellation.tsx:12`). The server route `app/api/applications/[id]/cancel/route.ts` is unchanged:
1. A participant picks REFUND for an unmatched application. The payment becomes REFUND_REQUESTED, the pass's remaining uses are set to 0, and the application stays SUBMITTED until the refund completes, or indefinitely if the refund fails.
2. They then POST to the cancel endpoint directly or from a stale tab, at least 48 hours before the event.
3. The refund branch at `cancel/route.ts:43` needs `payment_status==='PAID'`, so it's skipped. Execution falls through to the CANCELED_EARLY branch at `cancel/route.ts:57`, which restores the pass.
4. The resolution still has `selected_choice='REFUND'` with status REFUND_REQUESTED or FAILED. That is exactly what `completeVirtualRefund` now accepts, so the queued job or an operator retry also refunds the money.

The participant ends up with both a usable pass and a refund. This affects SINGLE and THREE_PASS purchases. None of the new tests cover cancelling after a refund choice.

**Fix:** inside the locked transaction, the cancel route should reject any application whose resolution has `selected_choice='REFUND'` or whose payment status starts with `REFUND_`. The restore branch should only run when `payment_status='PAID'` or the pass was an EXISTING_PASS. Add a test for refund failed → cancel rejected.

## Your claims checked
- **REFUND is immutable:** `lib/lifecycle-service.ts:307-310` rejects any other choice and replays REFUND idempotently. Refunding applications can't re-enter matching, because candidates need `p.status='PAID'` (`lib/matching-policy.ts:~38`).
- **Refund completion is guarded:** `lib/virtual-transactions.ts:7` joins and locks the resolution row. Line 10 requires `selected_choice='REFUND'` and status REFUND_REQUESTED or FAILED, and a completed refund still replays at line 9.
- **Worker:**
  - A successful job resolves its job-key exception (`worker/index.ts:~258-259`).
  - A terminal failure reopens the existing row instead of adding a duplicate (`worker/index.ts:~303-310`).
  - The failed-refund updates are guarded, and the payment becomes REFUND_FAILED (`worker/index.ts:~313-316`).
- **API and UI:**
  - The journey API returns `selected_choice` and leaves refund-selected cases out of `alternativeCount` (`app/api/journey/route.ts:20,36,43`).
  - Both the resolution view (`journey-pages.tsx:23`) and `ApplicationCard` (`journey-ui.tsx:175`) hide the other choices for refund-selected cases.
- **Profile:** the PUT blocks unknown gender while a paid, submitted application exists, under the lifecycle lock (`app/api/profile/route.ts:45-48`).
- **Tests:** the SQLite and Postgres fixtures now use MAN. The new regression tests exist (`tests/virtual-payments.test.ts:34,53`). I'm relying on your reported pass counts; I didn't run anything.

## Disposition of my last findings
1. **Refund double-compensation:** fixed on the resolution, worker and retry paths. The cancel-route residual above remains.
2. **Exceptions stuck at RETRYING or duplicated:** fixed.
3. **Fixture regression:** fixed in code. Only your snapshot results back this up.
4. **Cancel uses the earliest option, including past dates:** unchanged (`cancel/route.ts:21`). Still medium.
5. **Changing gender to unknown while waiting:** fixed.
6. **Low items:** not re-checked. Also new and minor: the pending list's `alternative` flag (`components/meeting-experience.tsx:24`) doesn't exclude refund-selected cases, so a refund that is pending or failed still shows "다음 일정 선택". The server rejects the choice, so this is a labelling problem only.

The hard gender policy and the six primary admin menus are intentional scope and I didn't score them as defects.

## Scores (1–5)
| Category | Score | Reason |
|---|---|---|
| PRD compliance | 4 (same) | Refund and exception automation now matches the PRD; the cancel residual undermines "자동 환불" integrity |
| Participant UX | 3.5 (same) | Correct choice locking; the pending-list label for refunding cases is misleading |
| Operator UX | 3.5 (up from 3) | Exception lifecycle is now correct in code; the inbox is still under the collapsed settings menu by design |
| Accessibility | 3.5 (same) | No new evidence |
| Reliability | 3 (same) | Retry and refund guards are solid, but a reachable money race remains and the full Postgres suite and build aren't in yet |

**Evidence limits:** static reading only. No tests, browser or build were run by me, and your full PostgreSQL run and final build are still in progress. Reliability would reasonably reach 3.5–4 once the cancel guard and its test land and the Postgres suite and build pass.

---

## 4차 검토

I found no remaining HIGH issues in the code I read. The cancel/refund bypass from my last review is fixed on the server, not just in the UI, and a test covers it. This was a read-only code review on Opus 5.5 (`claude-opus-5-5`). I ran no tests, builds or browsers. The PostgreSQL 95/95, browser, onboarding and build results are yours, and the reruns for the last patch were still in progress.

## Cancel/refund fix
- **Cancel route:** `app/api/applications/[id]/cancel/route.ts:25-26` locks the resolution row. It then rejects the cancel if the resolution has `selected_choice='REFUND'` or the payment status starts with `REFUND`.
  - This runs after the application row lock and under the global lifecycle lock (Postgres). SQLite allows only one writer. So it can't interleave with `resolveApplication` or the refund worker.
- **Credit restoration:** pass credit now comes back only for `PAID` or `EXISTING_PASS` applications (`cancel/route.ts:59`).
- **Tests:** `tests/virtual-payments.test.ts:34-50` loops over SINGLE and THREE_PASS. A direct cancel returns 400 both while the refund is pending and after it fails. The test also checks there's no RESTORE row, no restored credit, HOLD and TRANSFER are blocked, and exactly one refund on completion.
- **Pending list:** refunding applications are no longer labelled as needing a new date (`components/meeting-experience.tsx:24`).

## Other money paths re-checked
- **`completeVirtualRefund`** (`lib/virtual-transactions.ts:7-10`) only completes refunds the participant actually chose. A refund that already completed replays without paying out twice.
- **`resolveApplication`** (`lib/lifecycle-service.ts:307-310`): once REFUND is chosen it can't be changed to anything else.
- **`refundUnusedPass`** (`lib/virtual-transactions.ts:41-58`) uses the same lock and requires a `PAID` payment. It refuses while any future application is still using the pass, then zeroes the remaining uses. Its replay key is tied to that payment. A cancel afterwards can't restore credit, because no future application using the pass can exist.
- **Worker:** refund-failure updates are guarded, and exceptions are reopened rather than duplicated.

## Residual items (not HIGH)
- **Medium:** the cancel date is still taken from the earliest option, including past dates (`cancel/route.ts:21`, and mirrored in the UI). An unmatched applicant whose first option is today or already passed can be blocked even though later dates are open.
- **Medium:** check-in only works during the event, and feedback requires check-in. A participant who forgets to check in can't give feedback or mark people they'd rather not meet again (FDB-04).
- **Policy, intentional:** under the hard gender rule, "선택 안 함" users can't apply or remove their gender while a paid application is active. This is now explained before payment, so it's a product choice, not a defect.
- **Scope, intentional:** six primary admin menus, with 자동 처리 확인 under the collapsed settings menu. The dashboard's open attention panel makes up for it.
- **Low:** a few small low-contrast colors remain (`#948574`, and `#9c8975` on 10px brand text). Earlier low items, including the 환불 처리 실패 link going to `/admin/inbox`, weren't re-checked this round.

## Final scores (1–5)
| Category | Initial | Final | Reason |
|---|---|---|---|
| PRD compliance | 3.5 | **4** | Gender gate before charging, alternative/payment cards on home, exceptions inbox, pre-meal safety, refund integrity. The check-in/feedback gap keeps it below 4.5 |
| Participant UX | 3 | **3.5** | Clear eligibility, action cards, labels, confirmations, cancellation. Cancel-date edge case and feedback gating remain |
| Operator UX | 2.5 | **3.5** | Working exception lifecycle and inbox, attention panel open by default. The inbox is in a secondary menu, partly by design |
| Accessibility | 3 | **3.5** | Main text colors pass AA and alerts are kept. A few small low-contrast colors remain; no screen-reader or axe run by me |
| Reliability | 3.5 | **3.5** | All money races I found are closed in code, and you report PostgreSQL 95/95. Not 4 yet, because the last patch's PostgreSQL/SQLite reruns and the build are unfinished and I've only read the code |

Reliability could reasonably reach 4 once those reruns and the production build pass on the final patch. I haven't raised any other score beyond what the code shows.
