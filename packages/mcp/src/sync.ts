import { DEFAULT_PORT, type ClientMessage, type ServerMessage, type Session } from '@lottie-theme/sync/protocol';

/**
 * The agent's end of the live bridge (ROADMAP §6.3).
 *
 * Optional by construction: the MCP server is useful on its own, so a hub that is not
 * running must cost nothing. Every failure here is swallowed and reported as
 * `connected: false` — an agent that cannot reach the browser should carry on editing
 * files, not stop to complain about a socket.
 *
 * The client is Node's built-in WebSocket rather than the `ws` client the hub uses: this
 * side needs no server, and one fewer moving part in the agent's process is worth having.
 */

const url = () => {
  const configured = process.env.LOTTIE_THEME_SYNC;
  if (configured && configured !== '1' && configured !== 'on') return configured;
  return `ws://127.0.0.1:${process.env.LOTTIE_THEME_SYNC_PORT ?? DEFAULT_PORT}`;
};

export interface SyncState {
  connected: boolean;
  root: string | null;
  session: Session | null;
  error: string | null;
}

export class SyncClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private session: Session | null = null;
  private root: string | null = null;
  private error: string | null = null;

  private get enabled(): boolean {
    return process.env.LOTTIE_THEME_SYNC !== 'off';
  }

  /** Connect if we are not already; never throws, never blocks for long. */
  async ensure(): Promise<void> {
    if (!this.enabled || this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((done) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url());
      } catch (error) {
        this.error = (error as Error).message;
        return done();
      }
      const settle = () => {
        this.connecting = null;
        done();
      };
      const timer = setTimeout(settle, 1500);
      socket.addEventListener('open', () => {
        this.socket = socket;
        this.error = null;
        socket.send(JSON.stringify({ type: 'hello', role: 'agent', name: 'agent' } satisfies ClientMessage));
      });
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.type === 'welcome') {
          this.root = message.root;
          this.session = message.session;
          clearTimeout(timer);
          settle();
        } else if (message.type === 'session') {
          this.session = message.session;
        }
      });
      socket.addEventListener('error', () => {
        this.error = 'no sync hub is running';
        this.socket = null;
        clearTimeout(timer);
        settle();
      });
      socket.addEventListener('close', () => {
        this.socket = null;
        this.session = null;
      });
    });
    return this.connecting;
  }

  async state(): Promise<SyncState> {
    await this.ensure();
    const connected = this.socket?.readyState === WebSocket.OPEN;
    return {
      connected,
      root: connected ? this.root : null,
      session: connected ? this.session : null,
      error: connected ? null : (this.error ?? 'no sync hub is running'),
    };
  }

  /** Push an edit set into the browser. Returns whether anyone was listening. */
  async push(label: string, edits: unknown): Promise<boolean> {
    await this.ensure();
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type: 'edits', label, edits } as ClientMessage));
    return true;
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

export const sync = new SyncClient();
