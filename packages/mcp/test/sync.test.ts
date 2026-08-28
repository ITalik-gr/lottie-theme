import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hub } from '@lottie-theme/sync';
import type { ClientMessage, ServerMessage } from '@lottie-theme/sync/protocol';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The agent's side of the live bridge, against a real hub.
 *
 * The important property is not that it works when connected but that it is harmless when
 * it is not: the MCP server has to stay useful on its own.
 */

let hub: Hub;
let root: string;
let port: number;
let sync: typeof import('../src/sync.ts').sync;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lottie-mcp-sync-'));
  await writeFile(join(root, 'a.json'), JSON.stringify({ v: '5.7', fr: 30, ip: 0, op: 30, w: 10, h: 10, layers: [] }));
  hub = new Hub({ root, port: 0 });
  port = await hub.listen();
  process.env.LOTTIE_THEME_SYNC = `ws://127.0.0.1:${port}`;
  // Imported after the environment is set: the client reads it when it first connects.
  ({ sync } = await import('../src/sync.ts'));
});

afterAll(async () => {
  sync.close();
  await hub.close();
});

/** Stand in for the browser. */
function web() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const ready = new Promise<void>((done) => socket.addEventListener('open', () => done()));
  return {
    async join() {
      await ready;
      socket.send(JSON.stringify({ type: 'hello', role: 'web', name: 'browser' } satisfies ClientMessage));
    },
    send(message: ClientMessage) {
      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
    next(): Promise<ServerMessage> {
      return new Promise((done) => {
        const listener = (event: MessageEvent) => {
          socket.removeEventListener('message', listener);
          done(JSON.parse(String(event.data)) as ServerMessage);
        };
        socket.addEventListener('message', listener);
      });
    },
  };
}

describe('the agent bridge', () => {
  it('reports what the person has open and selected', async () => {
    const browser = web();
    await browser.join();
    browser.send({ type: 'open', path: 'a.json' });
    browser.send({
      type: 'selection',
      selection: { key: 'k', hex: '#101010', slots: [7], description: 'fill on card' },
    });
    await new Promise((done) => setTimeout(done, 150));

    const state = await sync.state();
    expect(state.connected).toBe(true);
    expect(state.root).toBe(root);
    expect(state.session?.path).toBe('a.json');
    expect(state.session?.selection.slots).toEqual([7]);
    browser.close();
  });

  it('pushes an edit set into the browser without touching the file', async () => {
    const browser = web();
    await browser.join();
    browser.send({ type: 'open', path: 'a.json' });
    await new Promise((done) => setTimeout(done, 100));

    const pushed = sync.push('agent: lighten the card', { version: 1, byIndex: { 7: '#FFFFFF' } });
    const seen = await browser.next();
    expect(await pushed).toBe(true);
    expect(seen.type === 'session' && seen.origin).toBe('agent');
    expect(seen.type === 'session' && seen.session.edits.byIndex).toEqual({ 7: '#FFFFFF' });
    browser.close();
  });
});

describe('with no hub running', () => {
  it('says so instead of failing, because the bridge is optional', async () => {
    process.env.LOTTIE_THEME_SYNC = 'ws://127.0.0.1:1';
    const { SyncClient } = await import('../src/sync.ts');
    const lonely = new SyncClient();
    const state = await lonely.state();
    expect(state.connected).toBe(false);
    expect(state.error).toBeTruthy();
    expect(await lonely.push('anything', { version: 1 })).toBe(false);
    process.env.LOTTIE_THEME_SYNC = `ws://127.0.0.1:${port}`;
  });
});
