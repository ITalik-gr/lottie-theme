import { describe, expect, it } from 'vitest';
import { emptyEdits } from '@lottie-theme/core';
import { emptySession, reduce } from '../src/session.ts';

const web = { role: 'web' as const, name: 'browser' };
const agent = { role: 'agent' as const, name: 'agent' };

describe('the shared session', () => {
  it('merges edits from both sides in the order they arrive', () => {
    let session = emptySession();
    session = reduce(session, { type: 'open', path: 'a.json' }, web).session;
    session = reduce(
      session,
      { type: 'edits', label: 'background', edits: { version: 1, byIndex: { 0: '#FFFFFF' } } },
      web,
    ).session;
    session = reduce(
      session,
      { type: 'edits', label: 'agent: text', edits: { version: 1, byIndex: { 1: '#111111' } } },
      agent,
    ).session;

    expect(session.edits.byIndex).toEqual({ 0: '#FFFFFF', 1: '#111111' });
    expect(session.activity.map((a) => a.origin)).toEqual(['web', 'agent']);
  });

  it('lets a replace express an undo, which a merge cannot', () => {
    let session = emptySession();
    session = reduce(session, { type: 'open', path: 'a.json' }, web).session;
    session = reduce(
      session,
      { type: 'edits', label: 'two colours', edits: { version: 1, byIndex: { 0: '#FFF', 1: '#000' } } },
      web,
    ).session;
    session = reduce(
      session,
      { type: 'edits', label: 'undo', edits: { version: 1, byIndex: { 0: '#FFFFFF' } }, replace: true },
      web,
    ).session;

    expect(session.edits.byIndex).toEqual({ 0: '#FFFFFF' });
  });

  it('starts over on a new file — one animation\'s indices mean nothing in another', () => {
    let session = emptySession();
    session = reduce(session, { type: 'open', path: 'a.json' }, web).session;
    session = reduce(session, { type: 'edits', label: 'x', edits: { version: 1, byIndex: { 3: '#FFF' } } }, web).session;
    session = reduce(session, { type: 'open', path: 'b.json' }, web).session;

    expect(session.path).toBe('b.json');
    expect(session.edits).toEqual(emptyEdits());
    expect(session.activity).toEqual([]);
  });

  it('carries the selection so an agent can be told “this one”', () => {
    let session = emptySession();
    session = reduce(session, { type: 'open', path: 'a.json' }, web).session;
    const selection = { key: 'k', hex: '#FF0000', slots: [4, 9], description: 'fill on badge' };
    session = reduce(session, { type: 'selection', selection }, web).session;
    expect(session.selection).toEqual(selection);
  });

  it('bumps the revision on every change, so a client can spot a re-send', () => {
    let session = emptySession();
    const first = reduce(session, { type: 'open', path: 'a.json' }, web).session;
    session = reduce(first, { type: 'edits', label: 'x', edits: { version: 1, byHex: { '#000000': '#FFFFFF' } } }, web).session;
    expect(session.revision).toBeGreaterThan(first.revision);
  });

  it('ignores an open for the file already in the session', () => {
    const opened = reduce(emptySession(), { type: 'open', path: 'a.json' }, web).session;
    const again = reduce(opened, { type: 'open', path: 'a.json' }, web);
    expect(again.session).toBe(opened);
    expect(again.label).toBeNull();
  });
});
