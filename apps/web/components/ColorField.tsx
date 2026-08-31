'use client';

import { useState } from 'react';
import { canonicalHex, isHex } from '@lottie-theme/core';
import { cn } from '@/lib/utils';

/**
 * The one way to change a colour in this app: a well you can click and a value you can type.
 *
 * Typing is committed only when it parses, so a half-typed `#1` never blanks the canvas —
 * and the field shows the draft while it is being typed rather than snapping back, which
 * is what makes it feel like a text field instead of a trap.
 */
export function ColorField({
  value,
  onCommit,
  size = 26,
  className,
}: {
  value: string;
  onCommit: (hex: string) => void;
  size?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value;
  const valid = isHex(shown);

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <label
        className="checker relative shrink-0 cursor-pointer rounded-[6px] ring-1 ring-white/15 ring-inset"
        style={{ width: size, height: size }}
        title="pick a colour"
      >
        <span className="block size-full rounded-[6px]" style={{ background: value }} />
        <input
          type="color"
          value={value}
          onChange={(e) => onCommit(canonicalHex(e.target.value))}
          className="absolute inset-0 size-full opacity-0"
        />
      </label>
      <input
        type="text"
        value={shown}
        spellCheck={false}
        onFocus={() => {
          setFocused(true);
          setDraft(value);
        }}
        onBlur={() => {
          setFocused(false);
          if (valid) onCommit(canonicalHex(draft));
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isHex(draft)) onCommit(canonicalHex(draft));
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
        className={cn(
          'h-[26px] w-[84px] rounded-md border bg-[var(--color-hover)] px-2 font-mono text-[12px] tabular-nums outline-none',
          valid ? 'border-[var(--color-line)]' : 'border-[var(--color-destructive)]',
        )}
      />
    </div>
  );
}
