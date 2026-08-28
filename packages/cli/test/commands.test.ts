import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectSlots, readEmbeddedEdits } from '@lottie-theme/core';
import { apply, list, mergeEdits, parseAssignments, report, suggest } from '../src/commands.ts';

const repoRoot = resolve(import.meta.dirname, '../../..');
const load = () => JSON.parse(readFileSync(resolve(repoRoot, 'lotties/Low Fidelity_anim(dark).json'), 'utf8'));

/** These read real animations from `lotties/`, which is a client's corpus and not
 *  necessarily checked out beside the code. Missing corpus is a skip, not a failure. */
const hasCorpus = existsSync(resolve(repoRoot, 'lotties'));

describe.skipIf(!hasCorpus)('report and list', () => {
  it('counts slots, editable colours and unique colours', () => {
    const r = report(load());
    expect(r.slots).toBeGreaterThan(0);
    expect(r.properties).toBeLessThanOrEqual(r.slots);
    expect(r.colors.reduce((n, c) => n + c.count, 0)).toBe(r.slots);
    expect(r.colors.map((c) => c.count)).toEqual([...r.colors.map((c) => c.count)].sort((a, b) => b - a));
  });

  it('lists every slot in order with a description', () => {
    const rows = list(load());
    expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i));
    expect(rows.every((r) => r.description.length > 0)).toBe(true);
  });
});

describe('parseAssignments', () => {
  it('reads colour and slot assignments', () => {
    expect(parseAssignments(['#17181D=#FFFFFF', '3=f0f'])).toEqual({
      version: 1,
      byHex: { '#17181D': '#FFFFFF' },
      byIndex: { 3: '#FF00FF' },
    });
  });

  it('accepts hex without a hash, and normalises case', () => {
    expect(parseAssignments(['17181d=ffffff']).byHex).toEqual({ '#17181D': '#FFFFFF' });
  });

  it('refuses input it cannot make sense of, instead of guessing', () => {
    expect(() => parseAssignments(['nonsense'])).toThrow(/KEY=VALUE/);
    expect(() => parseAssignments(['#17181D=purple'])).toThrow(/not a colour/);
    expect(() => parseAssignments(['surface=#FFFFFF'])).toThrow(/neither a colour nor a slot index/);
  });
});

describe('mergeEdits', () => {
  it('lets later sets win', () => {
    const merged = mergeEdits([
      { version: 1, byHex: { '#000000': '#FFFFFF', '#111111': '#EEEEEE' } },
      { version: 1, byHex: { '#000000': '#F6F8FF' } },
    ]);
    expect(merged.byHex).toEqual({ '#000000': '#F6F8FF', '#111111': '#EEEEEE' });
  });

  it('starts from an empty set', () => {
    expect(mergeEdits([]).version).toBe(1);
  });
});

describe.skipIf(!hasCorpus)('apply', () => {
  it('recolours and reports how much changed', () => {
    const doc = load();
    const top = report(doc).colors[0]!;
    const result = apply(doc, { version: 1, byHex: { [top.hex]: '#FF00FF' } });
    expect(result.colorsChanged).toBe(top.count);
    expect(collectSlots(result.doc).some((s) => s.hex === '#FF00FF')).toBe(true);
  });

  it('warns about entries that matched nothing rather than failing quietly', () => {
    const result = apply(load(), { version: 1, byHex: { '#123456': '#FFFFFF' }, byIndex: { 99999: '#FFFFFF' } });
    expect(result.warnings).toContain('no slot uses #123456');
    expect(result.warnings.some((w) => w.includes('99999'))).toBe(true);
  });

  it('embeds the edit set on request, so the output carries its own settings', () => {
    const result = apply(load(), { version: 1, byHex: { '#FFFFFF': '#000000' } }, { embed: true });
    expect(readEmbeddedEdits(result.doc)?.byHex).toEqual({ '#FFFFFF': '#000000' });
  });

  it('picks up an edit set already inside the document', () => {
    const withMeta = apply(load(), { version: 1, byHex: { '#FFFFFF': '#123456' } }, { embed: true }).doc;
    const result = apply(withMeta, { version: 1 }, { useEmbedded: true });
    expect(result.edits.byHex).toEqual({ '#FFFFFF': '#123456' });
  });

  it('narrows to by-hex edits when the structure does not match the reference', () => {
    const other = JSON.parse(readFileSync(resolve(repoRoot, 'lotties/checkmark_anim.json'), 'utf8'));
    const result = apply(
      load(),
      { version: 1, byHex: { '#FFFFFF': '#000000' }, byIndex: { 0: '#FF0000' } },
      { reference: collectSlots(other) },
    );
    expect(result.warnings[0]).toMatch(/by-hex edits only/);
    expect(result.edits.byIndex).toBeUndefined();
  });

  it('leaves the input document untouched', () => {
    const doc = load();
    const before = JSON.stringify(doc);
    apply(doc, { version: 1, byHex: { '#FFFFFF': '#000000' } }, { embed: true });
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe.skipIf(!hasCorpus)('suggest', () => {
  it('produces an edit set the apply step can use', () => {
    const doc = load();
    const suggestion = suggest(doc, 'light');
    expect(Object.keys(suggestion.edits.byIndex ?? {}).length).toBeGreaterThan(0);
    const result = apply(doc, suggestion.edits);
    expect(result.colorsChanged).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it('sends a fading gradient to the backdrop it is given', () => {
    // The backdrop only shows up where a gradient dissolves into it, so the file has to
    // actually have one — Low Fidelity does not, and comparing it proves nothing.
    const doc = JSON.parse(
      readFileSync(resolve(repoRoot, 'lotties/Landing Page/Affiliate Icons/icon_3.json'), 'utf8'),
    );
    const white = apply(doc, suggest(doc, 'light', '#FFFFFF').edits);
    const tinted = apply(doc, suggest(doc, 'light', '#F6F8FF').edits);
    expect(collectSlots(white.doc).some((s) => s.hex === '#FFFFFF')).toBe(true);
    expect(collectSlots(tinted.doc).some((s) => s.hex === '#F6F8FF')).toBe(true);
  });
});
