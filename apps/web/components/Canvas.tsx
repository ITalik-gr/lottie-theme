'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';
import { applyEdits, collectProperties, findNode, propertyIndex, slotsInSubtree } from '@lottie-theme/core';
import { buildProbeDoc, tagLiveSvg } from '@/lib/slotmap';
import { elementsForKeys, hitStack, highlight, xray, type Hit } from '@/lib/hittest';
import { mappedHex, propertyHex, useEditor } from '@/lib/store';
import { FileJson, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HitStackPopover } from './HitStackPopover';

const CHECKER = 'repeating-conic-gradient(#cfd2da 0% 25%, #ffffff 0% 50%) 0 0 / 16px 16px';

/** Time the pointer must be held before the stack starts stepping down on its own. */
const HOLD_START_MS = 400;
const HOLD_STEP_MS = 400;

export function Canvas() {
  const host = useRef<HTMLDivElement>(null);
  const probeHost = useRef<HTMLDivElement>(null);
  const anim = useRef<AnimationItem | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);

  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [stack, setStack] = useState<{ hits: Hit[]; x: number; y: number; cursor: number } | null>(null);
  const [mapping, setMapping] = useState<{ tagged: number; missing: number; mismatch: boolean } | null>(null);

  const original = useEditor((s) => s.original);
  const slots = useEditor((s) => s.slots);
  const edits = useEditor((s) => s.edits);
  const showOriginal = useEditor((s) => s.showOriginal);
  const background = useEditor((s) => s.background);
  const checkerboard = useEditor((s) => s.checkerboard);
  const includeTransparent = useEditor((s) => s.includeTransparent);
  const highlightKey = useEditor((s) => s.highlightKey);
  const highlightHex = useEditor((s) => s.highlightHex);
  const soloLayerId = useEditor((s) => s.soloLayerId);
  const tree = useEditor((s) => s.tree);
  const xrayOn = useEditor((s) => s.xray);
  const selectKey = useEditor((s) => s.selectProperty);
  const setHighlightKey = useEditor((s) => s.setHighlightKey);

  const properties = useMemo(() => collectProperties(slots), [slots]);
  const propertyMap = useMemo(() => propertyIndex(properties), [properties]);

  const rendered = useMemo(() => {
    if (!original) return null;
    return showOriginal ? original : applyEdits(original, edits).doc;
  }, [original, edits, showOriginal]);

  /**
   * Re-derive `data-props` on the live SVG.
   *
   * The probe is built from the document that is actually mounted, not from the original.
   * The two SVGs are compared structurally, and an edit that changes structure — moving a
   * gradient stop is enough — makes a probe of the original disagree with the live tree,
   * which drops the whole mapping and leaves the canvas unclickable. Colours in the probe
   * are overwritten by sentinels either way, so nothing is lost by mirroring the edits.
   */
  const tag = useCallback(() => {
    if (!rendered || !svg.current || !probeHost.current || !properties.length) return;
    const { doc: probeDoc, order } = buildProbeDoc(rendered, slots, properties);
    probeHost.current.innerHTML = '';
    const probe = lottie.loadAnimation({
      container: probeHost.current,
      renderer: 'svg',
      autoplay: false,
      animationData: probeDoc,
    });
    try {
      probe.goToAndStop(anim.current?.currentFrame ?? 0, true);
      const probeSvg = probeHost.current.querySelector('svg');
      if (probeSvg) {
        const result = tagLiveSvg(svg.current, probeSvg, order);
        setMapping({ tagged: result.tagged, missing: result.missing.length, mismatch: result.mismatch });
      }
    } finally {
      probe.destroy();
      probeHost.current.innerHTML = '';
    }
  }, [rendered, slots, properties]);

  useEffect(() => {
    if (!host.current || !rendered) return;
    const item = lottie.loadAnimation({
      container: host.current,
      renderer: 'svg',
      loop: true,
      autoplay: playing,
      animationData: structuredClone(rendered),
    });
    anim.current = item;
    item.addEventListener('DOMLoaded', () => {
      setTotalFrames(Math.round(item.totalFrames));
      svg.current = host.current?.querySelector('svg') ?? null;
      item.goToAndStop(frame, true);
      tag();
      if (playing) item.play();
    });
    item.addEventListener('enterFrame', () => setFrame(Math.round(item.currentFrame)));
    return () => {
      item.destroy();
      anim.current = null;
      svg.current = null;
    };
    // `frame` and `playing` are read, not tracked — re-mounting per frame would thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, tag]);

  /** Keys to spotlight: one property from the tree or popover, or every property the
   *  hovered palette row still governs.
   *
   *  "Still" is the whole of it: a row is a *source* colour, and an element recoloured
   *  on its own has left that row behind. Lighting it up anyway pointed at an element
   *  that no longer has the colour being hovered, which read as the editor having lost
   *  track of the change. */
  const spotlight = useMemo(() => {
    if (highlightKey) return [highlightKey];
    if (!highlightHex) return [];
    const rowTarget = mappedHex(edits, highlightHex);
    return properties
      .filter((p) => p.hex === highlightHex && propertyHex(edits, p) === rowTarget)
      .map((p) => p.key);
  }, [highlightKey, highlightHex, properties, edits]);

  // Hovering a palette row or a tree node dims everything else, instead of the PoC's
  // blinking magenta: the point is to *see* the shape, not to be told where it flashes.
  useEffect(() => {
    if (!svg.current || !spotlight.length) return;
    const targets = elementsForKeys(svg.current, spotlight);
    if (!targets.length) return;
    const restoreXray = xrayOn ? xray(svg.current, targets) : () => {};
    const restoreOutline = highlight(targets);
    return () => {
      restoreOutline();
      restoreXray();
    };
  }, [spotlight, xrayOn, mapping]);

  // Soloing a layer: hide everything the layer does not paint, so an unnamed group can
  // be identified by simply looking at what disappears.
  useEffect(() => {
    if (!svg.current || !soloLayerId) return;
    const node = findNode(tree, soloLayerId);
    if (!node) return;
    const keys = new Set(
      slotsInSubtree(node).map((i) => slots[i]?.renderKey).filter((k): k is string => !!k),
    );
    const targets = elementsForKeys(svg.current, keys);
    if (!targets.length) return;
    return xray(svg.current, targets);
  }, [soloLayerId, tree, slots, mapping]);

  const openStack = useCallback(
    (clientX: number, clientY: number) => {
      if (!svg.current || !original) return [] as Hit[];
      const hits = hitStack(svg.current, clientX, clientY, {
        doc: original,
        slots,
        properties: propertyMap,
        includeTransparent,
      });
      setStack(hits.length ? { hits, x: clientX, y: clientY, cursor: 0 } : null);
      return hits;
    },
    [original, slots, propertyMap, includeTransparent],
  );

  // Press and hold walks down the stack a layer at a time, highlighting each; letting
  // go picks the one on screen. Releasing early behaves as a plain click.
  const hold = useRef<{ timer: number; hits: Hit[]; index: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;

    // Clicking the same spot again steps one layer deeper, the way cmd-click does in a
    // design tool. The popover shows where in the stack you are, so it never becomes a
    // blind guess about how many layers are there.
    const near = stack && Math.hypot(stack.x - e.clientX, stack.y - e.clientY) < 4;
    if (near && !e.altKey) {
      const cursor = (stack.cursor + 1) % stack.hits.length;
      setStack({ ...stack, cursor });
      selectKey(stack.hits[cursor]!.property.key);
      return;
    }

    const hits = openStack(e.clientX, e.clientY);
    if (!hits.length) return;

    if (e.altKey) {
      // straight to the bottom of the stack
      selectKey(hits[hits.length - 1]!.property.key);
      setStack(null);
      return;
    }

    // The popover is open now; spotlighting the top hit immediately would dim the whole
    // canvas around something the user has not chosen yet. The hold walk does that.
    let index = 0;
    const step = () => {
      index = (index + 1) % hits.length;
      setHighlightKey(hits[index]!.property.key);
      if (hold.current) hold.current.index = index;
    };
    const timer = window.setTimeout(function tick() {
      step();
      const next = window.setTimeout(tick, HOLD_STEP_MS);
      if (hold.current) hold.current.timer = next;
    }, HOLD_START_MS);
    hold.current = { timer, hits, index };
  };

  const onPointerUp = () => {
    const held = hold.current;
    hold.current = null;
    if (!held) return;
    window.clearTimeout(held.timer);
    if (held.index > 0) {
      selectKey(held.hits[held.index]!.property.key);
      setStack(null);
    }
  };

  const scrub = (value: number) => {
    setFrame(value);
    setPlaying(false);
    anim.current?.goToAndStop(value, true);
    // Layers come and go over time, so the mapping is only valid for the frame on screen.
    requestAnimationFrame(tag);
  };

  const toggle = () => {
    const item = anim.current;
    if (!item) return;
    if (playing) item.pause();
    else item.play();
    setPlaying(!playing);
  };

  if (!original) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-fg-mute)]">
        <FileJson className="size-6" />
        <span className="text-[13px]">Drop a Lottie JSON, or pick one on the left.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-3">
      <div
        className="relative flex items-center justify-center rounded-2xl p-4 shadow-lg shadow-black/30"
        style={{ background: checkerboard ? CHECKER : background }}
      >
        <div
          ref={host}
          data-canvas-host
          className="size-[min(66vh,620px)] cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {/* the probe render: same document, sentinel colours, never shown */}
        <div ref={probeHost} aria-hidden className="pointer-events-none absolute size-px overflow-hidden opacity-0" />
      </div>

      {stack && (
        <HitStackPopover
          hits={stack.hits}
          cursor={stack.cursor}
          x={stack.x}
          y={stack.y}
          onClose={() => setStack(null)}
          onPick={(hit) => {
            selectKey(hit.property.key);
            setStack(null);
          }}
        />
      )}

      <div className="flex w-full max-w-[640px] items-center gap-3">
        <Button variant="secondary" size="icon-sm" onClick={toggle} aria-label={playing ? 'pause' : 'play'}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <input
          type="range"
          min={0}
          max={Math.max(totalFrames - 1, 0)}
          value={frame}
          onChange={(e) => scrub(Number(e.target.value))}
          className="flex-1 accent-[var(--color-brand)]"
        />
        <span className="w-20 text-right font-mono text-[11px] tabular-nums text-[var(--color-fg-mute)]">
          {frame} / {Math.max(totalFrames - 1, 0)}
        </span>
      </div>

      <p className="text-[11px] text-[var(--color-fg-mute)]" data-testid="mapping-status">
        {mapping
          ? mapping.mismatch
            ? 'colour mapping unavailable for this file'
            : `${mapping.tagged} clickable elements${mapping.missing ? ` · ${mapping.missing} not drawn at this frame` : ''}`
          : 'mapping…'}
      </p>
    </div>
  );
}
