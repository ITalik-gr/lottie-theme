import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hub } from '../src/hub.ts';
import type { ClientMessage, ServerMessage } from '../src/protocol.ts';

/** Drives the hub over real sockets, the way the browser and an agent do. */

const doc = {
  v: '5.7', fr: 30, ip: 0, op: 30, w: 100, h: 100,
  layers: [
    { ty: 4, nm: 'box', ip: 0, op: 30, ind: 1, shapes: [{ ty: 'fl', c: { a: 0, k: [0, 0, 0, 1] } }] },
  ],
};

let root: string;
let hub: Hub;
let port: number;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'lottie-sync-'));
  await writeFile(join(root, 'a.json'), JSON.stringify(doc));
  // Port 0: the OS picks a free one, so the suite never fights a hub the user is running.
  hub = new Hub({ root, port: 0 });
  port = await hub.listen();
});

afterAll(() => hub.close());

/** A client that queues what it receives, so a test can wait for one message. */
function connect(role: 'web' | 'agent') {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox: ServerMessage[] = [];
  const waiting: ((m: ServerMessage) => void)[] = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const next = waiting.shift();
    if (next) next(message);
    else inbox.push(message);
  });
  const ready = new Promise<void>((done) => socket.addEventListener('open', () => done()));

  const client = {
    socket,
    async hello() {
      await ready;
      socket.send(JSON.stringify({ type: 'hello', role, name: role } satisfies ClientMessage));
      return client.next();
    },
    send(message: ClientMessage) {
      socket.send(JSON.stringify(message));
    },
    next(): Promise<ServerMessage> {
      const queued = inbox.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((done) => {
        waiting.push(done);
        setTimeout(() => done({ type: 'error', message: 'timed out' }), 4000);
      });
    },
    /** Skip past messages a test is not asking about. */
    async until<T extends ServerMessage['type']>(type: T) {
      for (let i = 0; i < 10; i++) {
        const message = await client.next();
        if (message.type === type) return message as Extract<ServerMessage, { type: T }>;
      }
      throw new Error(`no ${type} arrived`);
    },
    close() {
      socket.close();
    },
  };
  return client;
}

describe('the hub', () => {
  it('greets a client with the workspace and the session so far', async () => {
    const web = connect('web');
    const welcome = await web.hello();
    expect(welcome.type).toBe('welcome');
    if (welcome.type === 'welcome') expect(welcome.root).toBe(root);
    web.close();
  });

  it("carries an agent's edit to the browser, and the browser's back", async () => {
    const web = connect('web');
    const agent = connect('agent');
    await web.hello();
    await agent.hello();

    web.send({ type: 'open', path: 'a.json' });
    // The open reaches everyone, its author included; the next session is the edit.
    await web.until('session');
    await agent.until('session');

    agent.send({ type: 'edits', label: 'agent: white box', edits: { version: 1, byIndex: { 0: '#FFFFFF' } } });
    const seen = await web.until('session');
    expect(seen.session.edits.byIndex).toEqual({ 0: '#FFFFFF' });
    expect(seen.origin).toBe('agent');
    expect(seen.label).toBe('agent: white box');

    await agent.until('session'); // the agent's own edit, echoed back to it

    // …and the human's selection reaches the agent, which is what "make this one white" needs.
    web.send({
      type: 'selection',
      selection: { key: 'k', hex: '#FFFFFF', slots: [0], description: 'fill on box' },
    });
    const back = await agent.until('session');
    expect(back.session.selection.slots).toEqual([0]);

    web.close();
    agent.close();
  });

  it('writes the file only when asked, with the edit set embedded', async () => {
    const web = connect('web');
    await web.hello();
    web.send({ type: 'open', path: 'a.json' });
    web.send({ type: 'edits', label: 'white', edits: { version: 1, byIndex: { 0: '#FFFFFF' } } });

    // Until the save, the file on disk is untouched — experimenting is not publishing.
    const before = JSON.parse(await readFile(join(root, 'a.json'), 'utf8'));
    expect(before.layers[0].shapes[0].c.k[0]).toBe(0);

    web.send({ type: 'save' });
    const saved = await web.until('saved');
    expect(saved.type === 'saved' && saved.colorsChanged).toBe(1);

    const after = JSON.parse(await readFile(join(root, 'a.json'), 'utf8'));
    expect(after.layers[0].shapes[0].c.k[0]).toBe(1);
    expect(after.meta.themeStudio.byIndex).toEqual({ 0: '#FFFFFF' });
    web.close();
  });

  it('refuses to write outside the workspace', async () => {
    const web = connect('web');
    await web.hello();
    web.send({ type: 'open', path: 'b.json' });
    web.send({ type: 'edits', label: 'white', edits: { version: 1, byIndex: { 0: '#FFFFFF' } } });
    web.send({ type: 'save', out: '../escaped.json' });
    const error = await web.until('error');
    expect(error.message).toContain('outside the workspace');
    web.close();
  });

  it('reports a file changed underneath it', async () => {
    const web = connect('web');
    await web.hello();
    web.send({ type: 'open', path: 'c.json' });
    await new Promise((done) => setTimeout(done, 200));
    // Someone editing the JSON by hand, or an agent writing the file directly.
    await writeFile(join(root, 'c.json'), JSON.stringify({ ...doc, nm: 'edited by hand' }));
    const changed = await web.until('file-changed');
    expect(changed.type === 'file-changed' && changed.path).toBe('c.json');
    web.close();
  });

  it('does not report its own save as someone else changing the file', async () => {
    const web = connect('web');
    await web.hello();
    web.send({ type: 'open', path: 'd.json' });
    await writeFile(join(root, 'd.json'), JSON.stringify(doc));
    // Let the watcher deliver the creation before the save it must not confuse with it.
    await new Promise((done) => setTimeout(done, 300));
    web.send({ type: 'edits', label: 'white', edits: { version: 1, byIndex: { 0: '#FFFFFF' } } });
    web.send({ type: 'save' });
    await web.until('saved');

    await new Promise((done) => setTimeout(done, 600));
    const noise = [];
    for (;;) {
      const message = await Promise.race([
        web.next(),
        new Promise<null>((done) => setTimeout(() => done(null), 150)),
      ]);
      if (!message) break;
      if (message.type === 'file-changed' && message.path === 'd.json') noise.push(message);
    }
    expect(noise).toEqual([]);
    web.close();
  });
});
