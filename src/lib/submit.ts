/**
 * One submission at a time, latched on a REF rather than on state.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * **A GUARD WRITTEN AS COMPONENT STATE CANNOT SEE A SECOND EVENT IN THE SAME TICK.**
 *
 * Every spending form on this surface used to be written the same way:
 *
 *     const [busy, setBusy] = useState(false)
 *     const submit = async () => { setBusy(true); try { await post() } finally { setBusy(false) } }
 *     <button disabled={busy} onClick={() => void submit()}>
 *
 * and every one of them sent TWO requests for one double click. Both halves of that shape have
 * the same hole:
 *
 *   * `busy` is read out of the render closure. `setBusy(true)` only SCHEDULES a render, so a
 *     second click dispatched before React commits still reads `busy === false` — and an
 *     `if (busy) return` written above it would not have helped, which is why adding one was not
 *     the fix.
 *   * `disabled={busy}` is not on the DOM node until that render commits either. A browser
 *     dispatches both clicks of a double click before any of it has happened.
 *
 * A ref has neither hole: `latch.current = true` is a plain assignment, visible to the very next
 * statement in the very same tick. So the ref is THE CORRECTNESS GUARANTEE and `busy` stays
 * exactly what it always was — THE VISIBLE AFFORDANCE, the thing that greys the button out and
 * changes its label. Both are returned here because a component that had only the ref would have
 * no way to say "Buying…", and a component that had only the state would be the bug again.
 *
 * ── WHY THIS IS ONE HOOK AND NOT SIX COPIES ───────────────────────────────────────────────────
 *
 * `src/lib/resource.ts` makes the argument for reads: "every screen that computes it by hand
 * eventually gets one of the cases wrong ... The decision is made once here, as a pure function,
 * so the wrong version cannot be written a seventh time." Six forms here — buy, bid, offer,
 * activate, create, dispute — were the same three lines six times, and all six were wrong in the
 * same way. This is that argument applied to writes.
 *
 * ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────────────────────────
 *
 * It does not touch the idempotency key, and it must never start. `src/lib/intent.ts` mints one
 * key per INTENT at mount and renews it only after a success, and that is the mechanism that
 * makes a duplicate harmless AT THE SERVER (`market/src/server.ts`). This hook is about
 * how many requests leave the BROWSER, which is a different question with a different answer:
 * `market/src/server.ts` answers a second concurrent request under a live key with 503
 * `in_flight`, and a client that renders that as "The purchase did not go through." has told a
 * buyer their money did not move while it was moving. The service's own comment says so —
 * "telling a client 'conflict' for work that is about to commit is how a purchase gets reported
 * as failed" — and the only way not to be that client is not to send the second request.
 *
 * It also does not swallow errors. A rejection from `work` propagates out of `run` untouched; the
 * caller's own `try/catch` stays inside `work`, next to the sentence it renders. What `run`
 * guarantees is only that the latch is released either way, so a form is never wedged by a throw
 * it did not expect — `test/double-submit.test.ts` presses a probe whose work throws twice in a
 * row and requires both presses to run.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useRef, useState } from 'react'

export interface Submitter {
  /** True while a submission is in flight. For `disabled` and for the button's label. */
  readonly busy: boolean
  /**
   * Run `work` unless a submission is already in flight, in which case do nothing at all.
   *
   * The latch is taken SYNCHRONOUSLY, before `work` is invoked and therefore before its first
   * `await`, and released in a `finally` so a throw cannot leave the form wedged.
   */
  readonly run: (work: () => Promise<void>) => Promise<void>
}

export function useSubmit(): Submitter {
  // Not `useState`: the whole point is a value that is written and read in the same tick.
  //
  // Under `<StrictMode>` (src/main.tsx) React double-invokes the component function on mount, so
  // this initialiser runs twice and one of the two refs is discarded. That is harmless — both
  // start `false`, and from the first commit onwards there is exactly one ref, which is the one
  // both clicks of a double click read. `test/double-submit.test.ts` runs every proof with
  // `strict: true` as well as without, because a guard that has only ever run outside StrictMode
  // is a guard that has never run the way the app runs it.
  const latch = useRef(false)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    if (latch.current) return
    latch.current = true
    setBusy(true)
    try {
      await work()
    } finally {
      // The ref first, and both in the `finally`. Releasing after the `try` instead would
      // leave the form permanently dead the first time the work threw — which is the
      // failure mode that makes people delete the latch rather than fix it.
      latch.current = false
      setBusy(false)
    }
  }, [])

  return { busy, run }
}
