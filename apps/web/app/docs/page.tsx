import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

/**
 * Where colour lives inside a Lottie document.
 *
 * This is not documented properly anywhere, which is why every tool in this space gets
 * gradients and solid layers wrong. Writing it down is worth as much as the editor.
 */

const ROWS: { where: string; shape: string; note: string }[] = [
  {
    where: 'Solid fill or stroke',
    shape: 'shape item `fl` / `st` → `c.k`',
    note: 'Three numbers, normally 0..1. Some exporters write 0..255 instead, so both have to be accepted.',
  },
  {
    where: 'Animated fill or stroke',
    shape: '`c.k[i].s` and `c.k[i].e`',
    note: 'One colour per keyframe end. They interpolate into a single painted colour, so they are one editable value even though each keyframe is separately addressable.',
  },
  {
    where: 'Gradient',
    shape: '`gf` / `gs` → `g.k.k`',
    note: 'One flat array. The first `g.p` groups of four are `position, r, g, b`. Nothing marks where they stop — you have to read `g.p`.',
  },
  {
    where: 'Gradient alpha ramp',
    shape: 'the same array, after `g.p * 4`',
    note: 'Pairs of `position, alpha`. This is the part everyone misses. Without it a gradient cannot be interpreted: a ramp reaching 0 is a mask dissolving into whatever is behind, not a shape with a colour.',
  },
  {
    where: 'Animated gradient',
    shape: '`g.k.k[i].s`',
    note: 'The whole ramp is keyframed, so `g.k.k` holds keyframe objects rather than numbers. Code that assumes numbers silently produces nothing.',
  },
  {
    where: 'Solid layer',
    shape: 'layer `ty: 1` → `sc`',
    note: 'A `#rrggbb` string, not an array, and it sits on the layer rather than in the shape tree. Easy to miss entirely — there are 41 of them in the corpus this was built against.',
  },
  {
    where: 'Text',
    shape: '`t.d.k[i].s.fc` and `.sc`',
    note: 'Fill and stroke of a text document, animated per keyframe. Most "text" in exported files is converted to paths and is really just `fl`, but real text layers do exist.',
  },
  {
    where: 'Effect colour',
    shape: 'layer `ef[].ef[]` with `ty: 2` → `v.k`',
    note: 'A Drop Shadow carries its own colour, and nothing in the layer\u2019s shapes mentions it. No palette built from fills and strokes will ever show it \u2014 which is how a violet glow survives a dark-to-light conversion and lands as a pink halo on a white page. Addressed by path, not by slot index, so that finding it did not renumber every slot in every file already converted.',
  },
  {
    where: 'Raster image',
    shape: '`assets[].p`',
    note: 'A data URI when embedded, a filename when not. Dark bitmaps are why a converted animation still has dark patches.',
  },
];

export default function Docs() {
  return (
    <main className="mx-auto max-w-[860px] px-6 py-16">
      <Link href="/" className="text-[13px] text-[var(--color-fg-mute)] hover:text-[var(--color-fg)]">
        ← Lottie Theme Studio
      </Link>

      <h1 className="mt-6 text-[30px] font-semibold tracking-tight">How Lottie stores colour</h1>
      <p className="mt-3 max-w-[640px] text-[16px] leading-relaxed text-[var(--color-fg-dim)]">
        Colour is scattered across a Lottie document in eight different shapes, and the
        format specification is thin about most of them. This is what a tool has to handle
        to recolour a real file correctly.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-[var(--color-ink-3)] text-[12px] uppercase tracking-wider text-[var(--color-fg-mute)]">
              <th className="py-2 pr-4 font-medium">Where</th>
              <th className="py-2 pr-4 font-medium">Shape</th>
              <th className="py-2 font-medium">Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.where} className="border-b border-[var(--color-ink-3)] align-top">
                <td className="py-3 pr-4 whitespace-nowrap">{row.where}</td>
                <td className="py-3 pr-4 font-mono text-[12px] text-[var(--color-fg-dim)]">{row.shape}</td>
                <td className="py-3 text-[var(--color-fg-dim)]">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 text-[20px] font-semibold">Slots, and why their order is a contract</h2>
      <p className="mt-3 max-w-[680px] text-[15px] leading-relaxed text-[var(--color-fg-dim)]">
        Every colour above is addressed as a <em>slot</em>: a path into the document plus an
        offset. Slots are numbered by walking layers in z-order and descending into precomp
        assets where they are referenced. That order is the contract — it is what makes a
        saved colour map, a set of groups or a named theme still land on the right shapes
        after the file is exported and re-imported.
      </p>

      <h2 className="mt-10 text-[20px] font-semibold">A slot is not an editable colour</h2>
      <p className="mt-3 max-w-[680px] text-[15px] leading-relaxed text-[var(--color-fg-dim)]">
        A precomp referenced by ten layers is one JSON object walked ten times. Ten slots,
        one value: change it and all ten change, and no tool can give them different
        colours without splitting the asset. In one file of the corpus that is 110 slots
        collapsing to 11 colours you can actually edit — which is exactly how many
        lottie-web paints.
      </p>

      <h2 className="mt-10 text-[20px] font-semibold">The gradient rule</h2>
      <p className="mt-3 max-w-[680px] text-[15px] leading-relaxed text-[var(--color-fg-dim)]">
        If a gradient&rsquo;s alpha ramp reaches zero, it is not a shape — it is a fade into
        whatever the animation sits on. Inverting its colours the way you would a surface
        leaves a dark halo on a light page. Its stops should take the colour of the new
        backdrop instead. This one rule accounts for most of what looks wrong in
        automatically converted animations.
      </p>

      <footer className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-ink-3)] pt-5 text-[13px] text-[var(--color-fg-mute)]">
        <span>Corrections welcome — this was derived from a real corpus, not from the spec.</span>
        <a
          href="https://www.italik.dev/?ref=lottie-editor"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 hover:text-[var(--color-fg)]"
        >
          italik.dev
          <ArrowUpRight className="size-3.5" />
        </a>
      </footer>
    </main>
  );
}
