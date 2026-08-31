'use client';

import { useEffect, useRef, useState } from 'react';
import type Anthropic from '@anthropic-ai/sdk';
import type { BetaToolRunner } from '@anthropic-ai/sdk/resources/beta/messages';
import type { ToolCall } from '@/lib/ai/tools';
import {
  DEFAULT_CEILING, EFFORTS, MODELS, measure, modelInfo, readSettings, writeSetting,
  type Effort, type Settings,
} from '@/lib/ai/settings';
import { useEditor } from '@/lib/store';
import {
  Brain, Check, ChevronDown, ChevronRight, Eraser, Loader2, SendHorizonal, Settings2, Square,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** How many requests one instruction may make before the loop stops on its own. A recolour
 *  that has not converged in this many rounds is not converging; letting it run was how a
 *  single "make this light" turned into three dollars. */
const MAX_ITERATIONS = 16;

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result: string | null }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string };

/** One tool call, folded to its name until asked. Unfolding shows what it was given and
 *  what it answered, which is the difference between watching the work and watching a
 *  list of verbs go by. */
function ToolRow({ entry }: { entry: Extract<Entry, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const args = entry.input && Object.keys(entry.input).length ? JSON.stringify(entry.input) : null;

  return (
    <div className="text-[11px] text-[var(--color-fg-mute)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded py-0.5 text-left hover:text-[var(--color-fg-dim)]"
      >
        {entry.result === null ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="font-mono">{entry.name}</span>
        {args && <span className="min-w-0 flex-1 truncate opacity-60">{args}</span>}
        <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="mt-1 mb-1 ml-4 space-y-1 border-l border-[var(--color-line)] pl-2">
          {args && (
            <pre className="overflow-x-auto font-mono text-[10px] whitespace-pre-wrap text-[var(--color-fg-dim)]">
              {JSON.stringify(entry.input, null, 2)}
            </pre>
          )}
          <pre className="max-h-40 overflow-y-auto font-mono text-[10px] whitespace-pre-wrap">
            {entry.result ?? 'running…'}
          </pre>
        </div>
      )}
    </div>
  );
}

/**
 * A picker whose trigger shows the choice and whose menu shows the reasons.
 *
 * It was one native `<select>` with "Sonnet 5 — most recolouring, at 40% of the price" as
 * the option text, which is the right information in the wrong place: the trigger is only
 * as wide as the panel, so every choice read as "Sonnet 5 — mo". The name goes on the
 * button and the reason goes where there is room for it.
 */
function Picker<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { id: T; label: string; note: string }[];
  label: string;
}) {
  const current = options.find((o) => o.id === value) ?? options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={label}
          className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-[var(--color-fg-dim)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)] data-[state=open]:bg-[var(--color-hover)] data-[state=open]:text-[var(--color-fg)]"
        >
          <span className="truncate">{current.label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[var(--color-fg-mute)]">{label}</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onSelect={() => onChange(option.id)}
            className="flex-col items-start gap-0.5"
          >
            <span className="flex w-full items-center gap-2 text-[12px]">
              {option.label}
              {option.id === value && <Check className="ml-auto size-3 text-[var(--color-brand-bright)]" />}
            </span>
            <span className="text-[11px] leading-snug text-[var(--color-fg-mute)]">{option.note}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * An agent working on the open animation, with the user's own key.
 *
 * Requests go from this page straight to the provider — there is no backend to route them
 * through, which is the same reason the animation itself never leaves the browser. The key
 * is stored in this browser and nowhere else.
 */
export function AgentPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [spend, setSpend] = useState({ cost: 0, input: 0, output: 0, cached: 0 });
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  /** Whether the log was scrolled to the bottom before the last append. Scrolling down on
   *  every token drags the view away from someone reading back through what happened. */
  const pinned = useRef(true);

  const currentId = useEditor((s) => s.currentId);
  const original = useEditor((s) => s.original);
  const setAgentBusy = useEditor((s) => s.setAgentBusy);

  useEffect(() => setSettings(readSettings()), []);

  useEffect(() => {
    if (pinned.current) log.current?.scrollTo({ top: log.current.scrollHeight });
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

  const update = (key: keyof Settings, value: string | number) => {
    writeSetting(key as never, value as never);
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  function stop() {
    abort.current?.abort();
  }

  function clear() {
    history.current = [];
    setEntries([]);
    setSpend({ cost: 0, input: 0, output: 0, cached: 0 });
  }

  async function send() {
    const prompt = draft.trim();
    if (!prompt || running || !settings?.apiKey || !original) return;
    const { model, effort, baseUrl, ceiling } = settings;
    setDraft('');
    push({ kind: 'user', text: prompt });
    setRunning(true);
    setAgentBusy(true);
    pinned.current = true;

    const controller = new AbortController();
    abort.current = controller;
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
        apiKey: settings.apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
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

      const onCall = (call: ToolCall) =>
        setEntries((list) => {
          const at = list.findIndex((e) => e.kind === 'tool' && e.id === call.id && e.result === null);
          if (at < 0) return list;
          const next = [...list];
          next[at] = { ...(next[at] as Extract<Entry, { kind: 'tool' }>), result: call.result };
          return next;
        });

      runner = client.beta.messages.toolRunner(
        {
          model,
          max_tokens: 16000,
          // Without `display`, the reasoning arrives as empty blocks and the panel shows a
          // long pause with nothing in it — on this model that is the default.
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort },
          system: [
            // The instructions never change during a session, so they are worth caching on
            // their own — and the breakpoint takes the tool definitions with them, since
            // tools are rendered ahead of the system prompt.
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          tools: buildTools(onCall),
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
        // One index per kind, so a turn that thinks, speaks, thinks again appends rather
        // than overwriting: each new block starts its own entry.
        let thinkingAt = -1;
        let textAt = -1;

        stream.on('thinking', (_delta, snapshot) => {
          setEntries((list) => {
            const next = [...list];
            if (thinkingAt < 0) {
              thinkingAt = next.length;
              next.push({ kind: 'thinking', text: snapshot });
            } else {
              next[thinkingAt] = { kind: 'thinking', text: snapshot };
            }
            return next;
          });
        });

        stream.on('text', (_delta, snapshot) => {
          setEntries((list) => {
            const next = [...list];
            if (textAt < 0) {
              textAt = next.length;
              next.push({ kind: 'assistant', text: snapshot });
            } else {
              next[textAt] = { kind: 'assistant', text: snapshot };
            }
            return next;
          });
        });

        const message = await stream.finalMessage();
        // The blocks arrive before the runner executes them; the row appears as pending and
        // `onCall` fills in the answer when it comes back.
        for (const block of message.content) {
          if (block.type === 'tool_use') {
            push({ kind: 'tool', id: block.id, name: block.name, input: block.input, result: null });
          }
        }

        if (message.usage) {
          const step = measure(message.usage, model);
          turnSpend += step.cost;
          setSpend((n) => ({
            cost: n.cost + step.cost,
            input: n.input + step.input,
            output: n.output + step.output,
            cached: n.cached + step.cached,
          }));
        }

        // Checked between iterations rather than inside one: a request already sent is
        // already billed, and cutting its response off saves nothing.
        if (turnSpend >= ceiling) {
          controller.abort();
          push({
            kind: 'notice',
            text: `Stopped at $${turnSpend.toFixed(2)} for this instruction. Say “continue” to carry on, or raise the limit in settings.`,
          });
          break;
        }
      }

      const final = await runner.done();
      if (final.stop_reason === 'max_tokens') {
        push({ kind: 'notice', text: 'The reply was cut off at the length limit.' });
      }
    } catch (error) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      // An abort is the Stop button working, not a failure. It is reported as a notice so
      // the log says where the conversation actually stops.
      if (controller.signal.aborted) {
        if (turnSpend < ceiling) push({ kind: 'notice', text: 'Stopped.' });
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
        push({ kind: 'error', text: message });
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

  // Nothing is read from storage until after mount — the page is prerendered, and a value
  // out of localStorage would not match what the server wrote.
  if (!settings) return <div className="h-full" />;

  if (!settings.apiKey) {
    return (
      <div className="flex h-full flex-col gap-3 px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-dim)]">
          Paste an Anthropic API key to work by describing what you want. Requests go from
          this page straight to the provider — there is no backend here to route them
          through, which is the same reason your animation never leaves the browser. The key
          is kept in this browser and nowhere else.
        </p>
        <input
          type="password"
          placeholder="sk-ant-…"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            update('apiKey', e.currentTarget.value.trim());
          }}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-hover)] px-2.5 py-1.5 font-mono text-[12px]"
        />
        <p className="text-[11px] leading-snug text-[var(--color-fg-mute)]">
          Press Enter to save. Billed to your own account, and it stops on its own at $
          {DEFAULT_CEILING.toFixed(2)} per instruction.
        </p>
      </div>
    );
  }

  const price = modelInfo(settings.model);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-0.5 px-2 py-1.5">
        <Picker
          value={settings.model}
          onChange={(id) => update('model', id)}
          options={MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note }))}
          label="model"
        />
        <span className="text-[var(--color-line)]">·</span>
        <Picker
          value={settings.effort}
          onChange={(id: Effort) => update('effort', id)}
          options={EFFORTS}
          label="effort"
        />

        <span className="ml-auto" />
        {spend.cost > 0 && (
          <span
            className="rounded px-1.5 text-[11px] tabular-nums text-[var(--color-fg-mute)]"
            title={`$${price.input}/$${price.output} per million tokens · ${spend.input.toLocaleString()} in (${spend.cached.toLocaleString()} cached) · ${spend.output.toLocaleString()} out`}
          >
            ~${spend.cost.toFixed(3)}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="clear the conversation"
          title="clear the conversation"
          disabled={running || !entries.length}
          onClick={clear}
        >
          <Eraser />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="settings"
          title="key, endpoint and spending limit"
          className={cn(showSettings && 'bg-[var(--color-hover)] text-[var(--color-fg)]')}
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings2 />
        </Button>
      </div>

      {showSettings && (
        <div className="shrink-0 space-y-3 border-y border-[var(--color-line)] bg-[var(--color-raised)] px-3 py-3">
          <label className="block">
            <span className="panel-title">endpoint</span>
            <input
              defaultValue={settings.baseUrl}
              placeholder="https://api.anthropic.com"
              // Enter as well as leaving the field. Typing an endpoint and pressing Enter
              // is the obvious gesture, and saving only on blur silently discarded it.
              // Saved here rather than by calling blur() and leaning on that: the same
              // value written twice costs nothing, and one path is one thing to be sure of.
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                update('baseUrl', e.currentTarget.value.trim());
                e.currentTarget.blur();
              }}
              onBlur={(e) => update('baseUrl', e.target.value.trim())}
              className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-[11px]"
            />
            <span className="mt-1 block text-[11px] leading-snug text-[var(--color-fg-mute)]">
              A gateway or proxy that speaks the Anthropic API. Empty means Anthropic.
            </span>
          </label>

          <label className="block">
            <span className="panel-title">spending limit</span>
            <span className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={5}
                step={0.1}
                value={settings.ceiling}
                onChange={(e) => update('ceiling', Number(e.target.value))}
                className="min-w-0 flex-1 accent-[var(--color-brand)]"
              />
              <span className="w-12 text-right text-[12px] tabular-nums text-[var(--color-fg-dim)]">
                ${settings.ceiling.toFixed(2)}
              </span>
            </span>
            <span className="mt-1 block text-[11px] leading-snug text-[var(--color-fg-mute)]">
              It stops and asks after this much on one instruction.
            </span>
          </label>

          <div className="flex justify-end border-t border-[var(--color-line)] pt-2.5">
            {/* A full-width button with an icon read as a primary action, which forgetting
                a key is the opposite of. It is a way out, so it looks like one. */}
            <button
              onClick={() => {
                update('apiKey', '');
                setShowSettings(false);
              }}
              className="rounded px-1 text-[11px] text-[var(--color-fg-mute)] underline-offset-2 transition-colors hover:text-[var(--color-destructive)] hover:underline"
            >
              forget the key stored in this browser
            </button>
          </div>
        </div>
      )}

      <div
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-w-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto px-3 pb-3"
      >
        {entries.length === 0 && (
          <p className="text-[12px] leading-relaxed text-[var(--color-fg-mute)]">
            Try: “make a light version of this, and check the result on white”, or “the
            glow around the badge still looks dark — fix just that”.
          </p>
        )}

        {entries.map((entry, i) => {
          if (entry.kind === 'tool') return <ToolRow key={`${entry.id}-${i}`} entry={entry} />;
          if (entry.kind === 'thinking') {
            return (
              <div key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-[var(--color-fg-mute)] italic">
                <Brain className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0 whitespace-pre-wrap">{entry.text}</span>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={cn(
                'text-[12px] leading-relaxed whitespace-pre-wrap',
                entry.kind === 'user' &&
                  'ml-6 rounded-lg rounded-br-sm bg-[var(--color-brand)]/15 px-2.5 py-1.5 text-[var(--color-fg)]',
                entry.kind === 'assistant' && 'px-0.5 text-[var(--color-fg-dim)]',
                entry.kind === 'error' &&
                  'rounded-lg border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-2.5 py-1.5 text-[var(--color-destructive)]',
                entry.kind === 'notice' &&
                  'rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[11px] text-[var(--color-fg-mute)]',
              )}
            >
              {entry.text}
            </div>
          );
        })}

        {running && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-fg-mute)]">
            <Loader2 className="size-3 animate-spin" />
            working…
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--color-line)] p-2">
        <div className="flex items-end gap-1.5">
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
            className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-hover)] px-2.5 py-1.5 text-[12px] disabled:opacity-40"
          />
          {running ? (
            <Button size="icon-sm" variant="secondary" onClick={stop} data-testid="agent-stop" title="stop (Esc)">
              <Square />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={() => void send()}
              disabled={!draft.trim() || !original}
              data-testid="agent-send"
              title="send (Enter)"
            >
              <SendHorizonal />
            </Button>
          )}
        </div>
        <p className="mt-1 px-1 text-[10px] text-[var(--color-fg-mute)]">
          {running ? 'Esc to stop' : 'Enter to send · Shift+Enter for a new line'}
        </p>
      </div>
    </div>
  );
}
