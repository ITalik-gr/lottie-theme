import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectSlots } from '../src/slots.ts';
import type { Slot, SlotKind } from '../src/types.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/poc-slots.json'), 'utf8'),
) as { slots: Record<string, string[]> };

/**
 * Guards the traversal order — the contract that makes slot indices stable, and
 * therefore makes saved colour maps and groups survive a re-import.
 *
 * The reference is `tools/colors.py` run over the real `lotties/` corpus, with two
 * deliberate deviations excluded from the comparison:
 *
 *  - solid layers (`ty:1` → `sc`) and text layers (`t.d.k[].s.fc/sc`) are new here;
 *    the PoC never saw them, and there are 41 solid layers in the corpus.
 *  - gradients with an *animated* ramp (`g.k.k` holding keyframes) are new here;
 *    the PoC silently emitted nothing for them.
 *
 * The fixture is regenerated with half-up rounding, because Python's banker's
 * rounding turns `0.3 * 255 = 76.5` into `#4C…` while every actual renderer gives `#4D…`.
 */
const POC_KINDS = new Set<SlotKind>(['fill', 'stroke', 'gradient-fill', 'gradient-stroke']);
const isAnimatedGradient = (s: Slot) => s.stop !== undefined && s.keyframe !== undefined;

const files = Object.keys(fixture.slots);

/** The corpus is a client's 216 MB of animations and is not necessarily checked out here.
 *  Without it this suite has nothing to compare against, which is a skip, not a failure. */
const hasCorpus = existsSync(resolve(repoRoot, 'lotties'));

describe.skipIf(!hasCorpus)('parity with tools/colors.py over the real corpus', () => {
  it('has a corpus to test against', () => {
    expect(files.length).toBe(53);
  });

  it.each(files)('%s', (file) => {
    const doc = JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8'));
    const mine = collectSlots(doc)
      .filter((s) => POC_KINDS.has(s.kind) && !isAnimatedGradient(s))
      .map((s) => s.hex);
    expect(mine).toEqual(fixture.slots[file]);
  });
});
