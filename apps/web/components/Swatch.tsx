'use client';

import { cn } from '@/lib/utils';

/**
 * A colour, shown as a colour.
 *
 * Every hex string in this app gets one. Reading `#B2B5C1` and picturing a grey-blue is
 * work; seeing it is not, and the whole point of the tool is judging colours against each
 * other. The checkerboard underneath matters for gradient stops, where the value can be
 * almost entirely transparent and would otherwise be indistinguishable from a dark chip.
 */
export function Swatch({
  hex,
  alpha = 1,
  size = 16,
  className,
  ring = true,
}: {
  hex: string;
  /** Effective opacity, when the caller knows it. */
  alpha?: number;
  size?: number;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      className={cn('checker inline-block shrink-0 rounded-[5px]', ring && 'ring-1 ring-white/15 ring-inset', className)}
      style={{ width: size, height: size }}
    >
      <span
        className="block size-full rounded-[5px]"
        style={{ background: hex, opacity: alpha }}
      />
    </span>
  );
}

/** Swatch plus the value, for lists and menu items where both are wanted. */
export function HexChip({ hex, className, size = 14 }: { hex: string; className?: string; size?: number }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Swatch hex={hex} size={size} />
      <span className="font-mono text-[12px] tabular-nums">{hex}</span>
    </span>
  );
}
