'use client';

import { AlertTriangle, ArrowRight, MoonStar, RefreshCw, Sun } from 'lucide-react';
import type { Role } from '@lottie-theme/core';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Swatch } from './Swatch';
import { useEditor } from '@/lib/store';

const ROLES: Role[] = ['surface', 'text', 'accent', 'muted', 'border', 'fade'];

const ROLE_HELP: Record<Role, string> = {
  surface: 'large background area — lightness is flipped',
  text: 'has to stay readable — flipped, then pushed to 4.5:1',
  accent: 'brand colour — hue and chroma kept, lightness nudged only if it stops standing out',
  muted: 'secondary grey — lightness flipped',
  border: 'stroke — flipped, then pushed to 3:1',
  fade: 'gradient dissolving into the backdrop — takes the backdrop colour',
};

/** The auto-generated theme, with its reasoning exposed so it can be corrected. */
export function SuggestPanel() {
  const roles = useEditor((s) => s.roles);
  const audit = useEditor((s) => s.audit);
  const properties = useEditor((s) => s.properties);
  const edits = useEditor((s) => s.edits);
  const setRole = useEditor((s) => s.setRole);
  const setHighlightKey = useEditor((s) => s.setHighlightKey);
  const selectProperty = useEditor((s) => s.selectProperty);
  const suggest = useEditor((s) => s.suggest);
  const original = useEditor((s) => s.original);

  if (!original) return null;

  if (!roles.length) {
    return (
      <div className="px-3 py-3">
        <p className="mb-3 text-[12px] leading-snug text-[var(--color-fg-mute)]">
          Generate the opposite theme as a draft: lightness is flipped in OKLCH so hues
          survive, brand colours are protected, and gradients that fade to nothing take
          the backdrop colour instead of being inverted into a dark halo.
        </p>
        <div className="flex gap-2">
          <Button size="sm" data-testid="suggest-light" onClick={() => suggest('light')}>
            <Sun />
            suggest light
          </Button>
          <Button size="sm" variant="outline" onClick={() => suggest('dark')}>
            <MoonStar />
            dark
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <span className="text-[12px] text-[var(--color-fg-dim)]">{roles.length} roles</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => suggest('light')} aria-label="re-run">
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Generate again with your corrections applied</TooltipContent>
        </Tooltip>
      </div>

      {audit.length > 0 && (
        <div className="mx-3 mb-2 shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5 shrink-0" />
            {audit.length} colour{audit.length === 1 ? '' : 's'} you will not be able to see
          </div>
          {audit.map((issue) => (
            <button
              key={issue.hex + issue.role}
              onClick={() => selectProperty(issue.keys[0] ?? null)}
              onMouseEnter={() => setHighlightKey(issue.keys[0] ?? null)}
              onMouseLeave={() => setHighlightKey(null)}
              className="flex w-full items-center gap-1.5 py-0.5 text-left hover:underline"
            >
              <Swatch hex={issue.hex} size={13} />
              <span className="font-mono tabular-nums">{issue.hex}</span>
              <span>on</span>
              <Swatch hex={issue.against} size={13} />
              <span className="tabular-nums">{issue.ratio.toFixed(1)}:1</span>
              <span className="text-amber-300/70">
                needs {issue.required}
                {issue.keys.length > 1 ? ` · ×${issue.keys.length}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3">
        {roles.map((guess) => {
          const property = properties.find((p) => p.key === guess.key);
          if (!property) return null;
          const after = edits.byIndex?.[property.slots[0] ?? -1] ?? property.hex;
          const failing = audit.some((a) => a.keys.includes(guess.key));
          return (
            <div
              key={guess.key}
              data-testid="role-row"
              onMouseEnter={() => setHighlightKey(guess.key)}
              onMouseLeave={() => setHighlightKey(null)}
              className={`mb-1 flex items-center gap-1.5 rounded-lg px-1.5 py-1.5 hover:bg-[var(--color-hover)] ${
                failing ? 'bg-amber-500/10' : ''
              }`}
            >
              <Swatch hex={property.hex} size={20} />
              <ArrowRight className="size-3 shrink-0 text-[var(--color-fg-mute)]" />
              <Swatch hex={after} size={20} />
              <Select value={guess.role} onValueChange={(v) => setRole(guess.key, v as Role)}>
                <SelectTrigger size="sm" className="h-7 w-[92px] shrink-0 text-[11px]" title={ROLE_HELP[guess.role]}>
                  <SelectValue>{guess.role}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      <span className="w-[52px] text-[12px]">{r}</span>
                      <span className="max-w-[200px] text-[11px] text-[var(--color-fg-mute)]">{ROLE_HELP[r]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-fg-mute)]" title={guess.reason}>
                {guess.reason}
              </span>
              <span
                className="shrink-0 text-[11px] tabular-nums text-[var(--color-fg-mute)]"
                title="how sure the heuristic was"
              >
                {Math.round(guess.confidence * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
