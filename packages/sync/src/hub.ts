import { readFile, writeFile } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { relative, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { applyEdits, embedEdits, isEmptyEdits } from '@lottie-theme/core';
import {
  DEFAULT_PORT, PROTOCOL_VERSION, parseMessage,
  type ClientMessage, type Role, type ServerMessage, type Session,
} from './protocol.ts';
import { emptySession, reduce } from './session.ts';

/**
 * The bridge between the editor in the browser and an agent in the terminal (ROADMAP §6.3).
 *
 * Dev-time only, and local only: it binds to the loopback interface, because it hands out
 * read and write access to a folder on disk. Nothing about the shipped product depends on
 * it — the web app works exactly as before when the hub is not running, which is what the
 * static export ships as.
 */

export interface HubOptions {
  root: string;
  port?: number;
  /** Called for every state change; the CLI prints these. */
  onLog?: (line: string) => void;
}

interface Client {
  id: string;
  role: Role;
  name: string;
  socket: WebSocket;
}

/** Never let a path out of the workspace: an agent should not read or overwrite something
 *  elsewhere on the disk because a prompt told it to. Deliberately not shared with the MCP
 *  server's Workspace — the core package stays filesystem-free so it can be bundled into
 *  the browser, and this is too small to justify a fourth package between them. */
function resolveInside(root: string, path: string): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`${path} is outside the workspace`);
  return full;
}

const IGNORED = ['node_modules', '.git', '.next', 'out', 'dist'];

/** Two browser windows on one session is an ordinary situation; the log has to be able to
 *  tell them apart, or a message bouncing between them looks like one client talking. */
const describe = (client: Client) => `${client.name}#${client.id}`;

export class Hub {
  readonly root: string;
  readonly port: number;
  private session: Session = emptySession();
  private clients = new Map<string, Client>();
  private server: Server;
  private wss: WebSocketServer;
  private watcher: FSWatcher | null = null;
  /** Paths this hub has just written, so its own save does not come back as a change. */
  private selfWrites = new Map<string, number>();
  private nextId = 1;
  private log: (line: string) => void;

  constructor(options: HubOptions) {
    this.root = resolve(options.root);
    this.port = options.port ?? DEFAULT_PORT;
    this.log = options.onLog ?? (() => {});
    this.server = createServer((_req, res) => {
      // A plain GET is how the web app checks whether a hub is there at all, without
      // opening a socket that a failed connection would log as an error in the console.
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ hub: 'lottie-theme', protocol: PROTOCOL_VERSION, root: this.root }));
    });
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (socket) => this.accept(socket));
  }

  async listen(): Promise<number> {
    await new Promise<void>((done, fail) => {
      this.server.once('error', fail);
      // Loopback only. The hub is a door into a directory; it has no business on the network.
      this.server.listen(this.port, '127.0.0.1', () => done());
    });
    const address = this.server.address();
    const port = typeof address === 'object' && address ? address.port : this.port;
    this.startWatching();
    this.log(`sync hub on ws://127.0.0.1:${port}, watching ${this.root}`);
    return port;
  }

  async close(): Promise<void> {
    this.watcher?.close();
    for (const client of this.clients.values()) client.socket.close();
    this.wss.close();
    await new Promise<void>((done) => this.server.close(() => done()));
  }

  state(): Session {
    return this.session;
  }

  private accept(socket: WebSocket) {
    const id = `c${this.nextId++}`;
    const client: Client = { id, role: 'agent', name: id, socket };
    this.clients.set(id, client);

    socket.on('message', (data) => {
      const message = parseMessage<ClientMessage>(String(data));
      if (!message) return;
      void this.handle(client, message);
    });
    socket.on('close', () => {
      this.clients.delete(id);
      this.log(`${describe(client)} left`);
    });
    socket.on('error', () => this.clients.delete(id));
  }

  private async handle(client: Client, message: ClientMessage) {
    switch (message.type) {
      case 'hello': {
        client.role = message.role;
        client.name = message.name ?? message.role;
        this.log(`${describe(client)} joined as ${client.role}`);
        this.send(client, {
          type: 'welcome',
          clientId: client.id,
          root: this.root,
          protocol: PROTOCOL_VERSION,
          session: this.session,
        });
        return;
      }

      case 'ping':
        return this.send(client, { type: 'pong' });

      case 'save':
        return this.save(client, message.out, message.embed ?? true);

      default: {
        const { session, label } = reduce(this.session, message, client);
        if (session === this.session) return;
        this.session = session;
        if (label) this.log(`${describe(client)}: ${label}`);
        this.broadcast({
          type: 'session',
          session,
          by: client.id,
          origin: client.role,
          label,
        });
      }
    }
  }

  /**
   * Write the open animation with the session's edits applied.
   *
   * Explicit, never automatic. The alternative — writing on every colour click — would
   * quietly rewrite the user's source files as they experiment, and an agent already sees
   * their unsaved work live through the session, so autosave would buy nothing.
   */
  private async save(client: Client, out: string | undefined, embed: boolean) {
    const { path, edits } = this.session;
    if (!path) return this.send(client, { type: 'error', message: 'nothing is open' });
    if (isEmptyEdits(edits)) return this.send(client, { type: 'error', message: 'nothing to save' });
    try {
      const source = resolveInside(this.root, path);
      const target = resolveInside(this.root, out ?? path);
      const doc = JSON.parse(await readFile(source, 'utf8'));
      const result = applyEdits(doc, edits);
      if (embed) embedEdits(result.doc, edits);
      this.selfWrites.set(target, Date.now());
      await writeFile(target, JSON.stringify(result.doc));
      const rel = relative(this.root, target);
      this.log(`saved ${rel} (${result.colorsChanged} colours)`);
      this.broadcast({
        type: 'saved',
        path: rel,
        colorsChanged: result.colorsChanged,
        rampsChanged: result.rampsChanged,
      });
    } catch (error) {
      this.send(client, { type: 'error', message: (error as Error).message });
    }
  }

  /**
   * Watch the workspace for edits made outside the session — an agent writing a file
   * directly, or a human editing the JSON by hand. The hub does not guess what to do with
   * them; it says which file moved and lets the browser offer to reload it.
   */
  private startWatching() {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = String(filename);
        if (!name.endsWith('.json')) return;
        if (IGNORED.some((dir) => name.split(sep).includes(dir))) return;
        const full = resolve(this.root, name);
        const written = this.selfWrites.get(full);
        // Our own save comes back through the watcher a moment later; that is not news.
        if (written && Date.now() - written < 2000) return;
        this.selfWrites.delete(full);
        this.broadcast({ type: 'file-changed', path: relative(this.root, full) });
      });
    } catch (error) {
      // A watch failure costs live reload, not the session. Say so and carry on.
      this.log(`not watching for file changes: ${(error as Error).message}`);
    }
  }

  private send(client: Client, message: ServerMessage) {
    if (client.socket.readyState === 1) client.socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.socket.readyState === 1) client.socket.send(payload);
    }
  }
}
