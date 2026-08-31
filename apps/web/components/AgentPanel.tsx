'use client';

import { useEffect, useRef, useState } from 'react';
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaToolRunner } from '@anthropic-ai/sdk/resources/beta/messages';
import { DEFAULT_MODEL, estimateCost, readApiKey, writeApiKey } from '@/lib/ai/settings';
import { useEditor } from '@/lib/store';
import { KeyRound, Loader2, Square, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MODEL = DEFAULT_MODEL;

/** How many requests one instruction may make before the loop stops on its own. A recolour
 *  that has not converged in this many rounds is not converging; letting it run was how a
 *  single "make this light" turned into three dollars. */
const MAX_ITERATIONS = 16;

/** Dollars one instruction may spend before stopping to ask. Deliberately low: it is the
 *  user's own key, and the failure mode being guarded against is a loop nobody is watching,
 *  not a turn that costs slightly more than expected. */
const SPEND_CEILING = 0.5;

interface Entry {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'notice';
  text: string;
}

/**
 * An agent working on the open animation, with the user's own key.
 *
 * Requests go from this page straight to the provider — there is no backend to route them
 * through, which is the same reason the animation itself never leaves the browser. The key
 * is stored in this browser and nowhere else.
 */
export function AgentPanel() {
  const [apiKey, setApiKey] = useState('');
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [spend, setSpend] = useState(0);
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);

  const currentId = useEditor((s) => s.currentId);
  const original = useEditor((s) => s.original);
  const setAgentBusy = useEditor((s) => s.setAgentBusy);

  useEffect(() => setApiKey(readApiKey()), []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [entries]);

  // A new file is a new conversation; carrying the old one over just misleads the model.
  useEffect(() => {
    history.current = [];
    setEntries([]);
  }, [currentId]);

  // A request in flight outlives this component if the user switches section, so the abort
  // belongs to the unmount as much as to the button.
  useEffect(() => () => abort.current?.abort(), []);

  const push = (entry: Entry) => setEntries((list) => [...list, entry]);

  function stop() {
    abort.current?.abort();
  }

  async function send() {
    const prompt = draft.trim();
    if (!prompt || running || !apiKey || !original) return;
    setDraft('');
    push({ role: 'user', text: prompt });
    setRunning(true);
    setAgentBusy(true);

    const controller = new AbortController();
    abort.current = controller;
    // Typed as a streaming runner: the iterator yields streams rather than messages, and
    // an inferred `boolean` here would make every iteration a union that has neither shape.
    let runner: BetaToolRunner<true> | null = null;
    let turnSpend = 0;

    try {
      // Loaded on demand: the SDK is a third of the editor's bundle and most people never
      // open this tab.
      const [{ default: Anthropic }, { buildTools, SYSTEM_PROMPT }] = await Promise.all([
        import('@anthropic-ai/sdk'),
        import('@/lib/ai/tools'),
      ]);

      const client = new Anthropic({
        apiKey,
        // Required for calling the API straight from a page. There is no server here to
        // proxy through, and adding one would mean the user's files leaving their machine.
        dangerouslyAllowBrowser: true,
      });

      // Caching matches a prefix, so a breakpoint on the newest message covers the tools,
      // the system prompt and everything said so far. Older breakpoints are cleared first:
      // a request may carry four, and the loop would otherwise accumulate one per turn.
      for (const message of history.current) {
        if (typeof message.content === 'string') continue;
        for (const block of message.content) delete (block as { cache_control?: unknown }).cache_control;
      }
      history.current.push({
        role: 'user',
        content: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
      });

      runner = client.beta.messages.toolRunner(
        {
          model: MODEL,
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          system: [
            // The instructions never change during a session, so they are worth caching on
            // their own — and the breakpoint takes the tool definitions with them, since
            // tools are rendered ahead of the system prompt.
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          tools: buildTools(),
          messages: history.current,
          max_iterations: MAX_ITERATIONS,
          betas: ['context-management-2025-06-27'],
          context_management: {
            // A palette dump and a canvas screenshot are worth reading once. Kept in the
            // history they are re-sent, and re-paid for, on every following request of the
            // loop — which was the largest part of the bill.
            edits: [
              {
                type: 'clear_tool_uses_20250919',
                keep: { type: 'tool_uses', value: 3 },
                clear_at_least: { type: 'input_tokens', value: 2000 },
                // What the agent changed is the one thing it must still be able to see.
                exclude_tools: ['apply_edits'],
              },
            ],
          },
          stream: true,
        },
        { signal: controller.signal },
      );

      for await (const stream of runner) {
        let text = '';
        let index = -1;
        stream.on('text', (chunk) => {
          text += chunk;
          setEntries((list) => {
            const next = [...list];
            if (index < 0) {
              index = next.length;
              next.push({ role: 'assistant', text });
            } else {
              next[index] = { role: 'assistant', text };
            }
            return next;
          });
        });

        const message = await stream.finalMessage();
        for (const block of message.content) {
          if (block.type === 'tool_use') push({ role: 'tool', text: block.name });
        }
        if (message.usage) {
          const cost = estimateCost(message.usage, MODEL);
          turnSpend += cost;
          setSpend((n) => n + cost);
        }

        // Checked between iterations rather than inside one: a request already sent is
        // already billed, and cutting its response off saves nothing.
        if (turnSpend >= SPEND_CEILING) {
          controller.abort();
          push({
            role: 'notice',
            text: `Stopped at $${turnSpend.toFixed(2)} for this instruction. Say “continue” to carry on.`,
          });
          break;
        }
      }

      const final = await runner.done();
      if (final.stop_reason === 'max_tokens') {
        push({ role: 'notice', text: 'The reply was cut off at the length limit.' });
      }
    } catch (error) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      // An abort is the Stop button working, not a failure. It is reported as a notice so
      // the log says where the conversation actually stops.
      if (controller.signal.aborted) {
        if (turnSpend < SPEND_CEILING) push({ role: 'notice', text: 'Stopped.' });
      } else {
        const message =
          error instanceof Anthropic.AuthenticationError
            ? 'That key was rejected.'
            : error instanceof Anthropic.RateLimitError
              ? 'Rate limited — try again shortly.'
              : // A connection error is an APIError with no status, and prefixing it with
                // the status printed "undefined: Connection error." at the one moment the
                // message needed to be plain.
                error instanceof Anthropic.APIError
                ? error.status
                  ? `${error.status}: ${error.message}`
                  : error.message
                : error instanceof Error
                  ? error.message
                  : 'Something went wrong.';
        push({ role: 'error', text: message });
      }
    } finally {
      // The runner accumulates assistant turns and tool results in its own params; take
      // them so the next turn continues the same conversation. Done here rather than after
      // the loop so an interrupted run can be picked back up instead of restarting.
      if (runner) history.current = [...runner.params.messages];
      abort.current = null;
      setRunning(false);
      setAgentBusy(false);
    }
  }

  if (!apiKey) {
    return (
      <div className="flex h-full flex-col gap-3 px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-dim)]">
          Paste an Anthropic API key to work by describing what you want. Requests go from
          this page straight to Anthropic — there is no backend here to route them through,
          which is the same reason your animation never leaves the browser. The key is kept
          in this browser and nowhere else.
        </p>
        <input
          type="password"
          placeholder="sk-ant-…"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const value = e.currentTarget.value;
            writeApiKey(value);
            setApiKey(value.trim());
          }}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-hover)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-[var(--color-brand)]"
        />
        <p className="text-[11px] leading-snug text-[var(--color-fg-mute)]">
          Press Enter to save. Billed to your own account, and it stops on its own at $
          {SPEND_CEILING.toFixed(2)} per instruction.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-[12px] text-[var(--color-fg-dim)]">{MODEL}</span>
        {spend > 0 && (
          <span
            className="rounded bg-[var(--color-line-soft)] px-1.5 py-px text-[11px] tabular-nums text-[var(--color-fg-mute)]"
            title="estimate over this session, billed to your key"
          >
            ~${spend.toFixed(3)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="forget key"
          title="forget the key stored in this browser"
          onClick={() => {
            writeApiKey('');
            setApiKey('');
          }}
        >
          <KeyRound />
        </Button>
      </div>

      <div ref={log} className="min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {entries.length === 0 && (
          <p className="text-[12px] leading-relaxed text-[var(--color-fg-mute)]">
            Try: “make a light version of this, and check the result on white”, or “the
            glow around the badge still looks dark — fix just that”.
          </p>
        )}
        {entries.map((entry, i) =>
          entry.role === 'tool' ? (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-mute)]">
              <Wrench className="size-3 shrink-0" />
              {entry.text}
            </div>
          ) : (
            <div
              key={i}
              className={`rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap ${
                entry.role === 'user'
                  ? 'bg-[var(--color-hover)]'
                  : entry.role === 'error'
                    ? 'border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]'
                    : entry.role === 'notice'
                      ? 'border border-[var(--color-line)] text-[var(--color-fg-mute)]'
                      : 'text-[var(--color-fg-dim)]'
              }`}
            >
              {entry.text}
            </div>
          ),
        )}
        {running && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-mute)]">
            <Loader2 className="size-3 animate-spin" />
            thinking…
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--color-line)] p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && running) {
              e.preventDefault();
              stop();
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={3}
          placeholder={original ? 'Describe what you want…' : 'Open an animation first'}
          disabled={!original || running}
          className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-hover)] px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-brand)] disabled:opacity-40"
        />
        <div className="mt-1 flex items-center gap-2 px-1">
          <p className="flex-1 text-[10px] text-[var(--color-fg-mute)]">
            {running ? 'Esc to stop' : 'Enter to send · Shift+Enter for a new line'}
          </p>
          {running && (
            <Button size="xs" variant="secondary" onClick={stop} data-testid="agent-stop">
              <Square />
              stop
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
