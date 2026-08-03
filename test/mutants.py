#!/usr/bin/env python3
"""
Mutation testing for the double-submit guards, against a STATED baseline.

    python3 test/mutants.py

Every mutation edits PRODUCTION source — never a test — runs the suite, and requires it to go RED.
A mutation the suite still passes is printed as SURVIVED, which means the assertion protecting that
line does not exist.

── WHY THE BASELINE IS ASSERTED FIRST, LOUDLY ────────────────────────────────────────────────────

A mutation script elsewhere in this estate reported all 26 of its guards alive while running
against a suite that was ALREADY RED. Every "killed" it printed was the pre-existing failure, not
the mutation. So this script:

  * runs the unmutated suite first and REFUSES to continue unless it is green;
  * restores after every mutation and re-runs, so a mutation that fails to revert cannot make the
    next one look killed;
  * asserts each mutation actually applied — a string that no longer matches the source is a
    mutation that never happened, and would otherwise be indistinguishable from a survivor being
    silently skipped.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

RUN = [
    "node",
    "--import",
    "tsx",
    "--import",
    "@cloudsforge/ui/test-loader",
    "--test",
    "test/double-submit.test.ts",
    "test/journeys.test.ts",
]

SOURCES = [
    "src/lib/submit.ts",
    "src/lib/intent.ts",
    "src/pages/listing.tsx",
    "src/pages/sell.tsx",
    "src/pages/orders.tsx",
]


def green() -> bool:
    return subprocess.run(RUN, cwd=ROOT, capture_output=True).returncode == 0


def restore() -> None:
    subprocess.run(["git", "checkout", "--", *SOURCES], cwd=ROOT, check=True)


# (name, file, find, replace). `find` must be present exactly once.
MUTATIONS: list[tuple[str, str, str, str]] = [
    (
        "submit: remove the ref latch entirely",
        "src/lib/submit.ts",
        "    if (latch.current) return\n    latch.current = true",
        "    latch.current = true",
    ),
    (
        "submit: invert the latch",
        "src/lib/submit.ts",
        "if (latch.current) return",
        "if (!latch.current) return",
    ),
    (
        "submit: guard on the busy STATE instead of the ref (the original defect)",
        "src/lib/submit.ts",
        "if (latch.current) return",
        "if (busy) return",
    ),
    (
        "submit: take the latch after the await rather than before it",
        "src/lib/submit.ts",
        "    latch.current = true\n    setBusy(true)\n    try {\n      await work()",
        "    setBusy(true)\n    try {\n      await work()\n      latch.current = true",
    ),
    (
        "submit: release outside the finally, so one throw wedges the form for good",
        "src/lib/submit.ts",
        "    } finally {\n"
        "      // The ref first, and both in the `finally`. Releasing after the `try` instead would\n"
        "      // leave the form permanently dead the first time the work threw — which is the\n"
        "      // failure mode that makes people delete the latch rather than fix it.\n"
        "      latch.current = false\n"
        "      setBusy(false)\n"
        "    }",
        "      latch.current = false\n      setBusy(false)\n    } finally {\n      void 0\n    }",
    ),
    (
        "submit: never raise busy, so the affordance never appears",
        "src/lib/submit.ts",
        "    latch.current = true\n    setBusy(true)",
        "    latch.current = true",
    ),
    (
        "submit: never lower busy, so the control never re-arms",
        "src/lib/submit.ts",
        "      latch.current = false\n      setBusy(false)",
        "      latch.current = false",
    ),
    (
        "intent: mint the key per render instead of once per mount",
        "src/lib/intent.ts",
        "const [key, setKey] = useState(() => newIdempotencyKey(prefix))",
        "const [, setKey] = useState(() => newIdempotencyKey(prefix))\n"
        "  const key = newIdempotencyKey(prefix)",
    ),
    (
        "listing: drop disabled from Buy",
        "src/pages/listing.tsx",
        'className="cf-btn cf-btn--ember" disabled={busy} onClick',
        'className="cf-btn cf-btn--ember" onClick',
    ),
    (
        "listing: drop disabled from Bid",
        "src/pages/listing.tsx",
        "disabled={busy || amount === ''} onClick={() => void submit()}>\n          {busy ? 'Bidding…' : 'Bid'}",
        "onClick={() => void submit()}>\n          {busy ? 'Bidding…' : 'Bid'}",
    ),
    (
        "listing: drop disabled from Offer",
        "src/pages/listing.tsx",
        "disabled={busy || amount === ''} onClick={() => void submit()}>\n          {busy ? 'Offering…' : 'Offer'}",
        "onClick={() => void submit()}>\n          {busy ? 'Offering…' : 'Offer'}",
    ),
    (
        "sell: drop disabled from Activate",
        "src/pages/sell.tsx",
        "        disabled={busy || (onchain && tx.trim() === '')}\n",
        "",
    ),
    (
        "sell: drop disabled from Create the listing",
        "src/pages/sell.tsx",
        "        disabled={busy || itemUrn.trim() === '' || !royaltyOk}\n",
        "",
    ),
    (
        "orders: drop disabled from Raise a dispute",
        "src/pages/orders.tsx",
        "            disabled={busy || reason.trim() === ''}\n",
        "",
    ),
]


def main() -> int:
    print("── baseline ──────────────────────────────────────────────────────────────")
    if not green():
        print("  RED before a single mutation. Every result below would be meaningless.")
        return 2
    print("  GREEN. Proceeding.\n")

    killed: list[str] = []
    survived: list[str] = []

    for name, rel, find, repl in MUTATIONS:
        path = ROOT / rel
        source = path.read_text()
        count = source.count(find)
        if count != 1:
            print(f"  !! NOT APPLIED ({count} matches) {name}")
            restore()
            return 3
        path.write_text(source.replace(find, repl, 1))
        if green():
            survived.append(name)
            print(f"  SURVIVED  {name}")
        else:
            killed.append(name)
            print(f"  killed    {name}")
        restore()

    print("\n── result ────────────────────────────────────────────────────────────────")
    print(f"  mutations: {len(MUTATIONS)}   killed: {len(killed)}   survived: {len(survived)}")
    for name in survived:
        print(f"  SURVIVED: {name}")
    print("  restored:", "GREEN" if green() else "RED — the tree is dirty")
    return 1 if survived else 0


if __name__ == "__main__":
    sys.exit(main())
