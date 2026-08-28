'use client';

import { useEffect, useRef, useState } from 'react';
import type Anthropic from '@anthropic-ai/sdk';
import { estimateCost, readApiKey, writeApiKey } from '@/lib/ai/settings';
import { useEditor } from '@/lib/store';
import { KeyRound, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

const MODEL = 'claude-opus-5';

interface Entry {
  role: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
}

/**
 * An agent working on the open animation, with the user's own key.
 *
 * Requests go from this page straight to the provider — there is no backend to route
 * them through, which is the same reason the animation itself never leaves the browser.
 * The key is stored in this browser and nowhere else.
 */
export function AgentPanel() {
  const [apiKey, setApiKey] = useState('');
  const [draft, setDraft] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  const [spend, setSpend] = useState(0);
  const history = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const log = useRef<HTMLDivElement>(null);

  const currentId = useEditor((s) => s.currentId);
  const original = useEditor((s) => s.original);

  useEffect(() => setApiKey(readApiKey()), []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [entries]);

  // A new file is a new conversation; carrying the old one over just misleads the model.
  useEffect(() => {
    history.current = [];
    setEntries([]);
  }, [currentId]);

  const push = (entry: Entry) => setEntries((list) => [...list, entry]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || running || !apiKey || !original) return;
    setDraft('');
    push({ role: 'user', text: prompt });
    setRunning(true);

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

      history.current.push({ role: 'user', content: prompt });

      const runner = client.beta.messages.toolRunner({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        tools: buildTools(),
        messages: history.current,
        stream: true,
      });

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
          setSpend((n) => n + estimateCost(message.usage.input_tokens, message.usage.output_tokens));
        }
      }

      // The runner accumulates assistant turns and tool results in its own params; take
      // them so the next turn continues the same conversation.
      history.current = [...runner.params.messages];
    } catch (error) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const message =
        error instanceof Anthropic.AuthenticationError
          ? 'That key was rejected.'
          : error instanceof Anthropic.RateLimitError
            ? 'Rate limited — try again shortly.'
            : error instanceof Anthropic.APIError
              ? `${error.status}: ${error.message}`
              : error instanceof Error
                ? error.message
                : 'Something went wrong.';
      push({ role: 'error', text: message });
    } finally {
      setRunning(false);
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
          Press Enter to save. Billed to your own account at roughly $5 per million input
          tokens; a turn on a small file is a fraction of a cent.
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
            title="rough estimate, billed to your key"
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
        <p className="mt-1 px-1 text-[10px] text-[var(--color-fg-mute)]">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
