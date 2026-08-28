---
name: lottie-theming
description: Recolour a Lottie animation — convert it between dark and light themes, match it to a reference screenshot, or change specific colours in it. Use whenever a .json Lottie file needs its colours changed, a light/dark version made, or a converted animation looks wrong (washed out, dark halos, patches that did not change).
---

# Recolouring a Lottie animation

You have the whole tool available as MCP tools. Use them; do not edit the JSON by hand and
do not write a script to do it. The reason is not tidiness — the traps below are in the
tool already, and hand-editing walks into every one of them.

## Before anything else: you must look at the result

`render_preview` renders the animation to a PNG and hands it to you. **Every job ends with
looking at one.** An animation whose JSON is correct still lands wrong on the page more
often than not, and the failures are invisible in the numbers: a gradient that fades to
transparent reads as fine in the file and shows up as a dark halo on white.

Pass a `background` that matches where the animation will actually sit. A ramp fading to
nothing is meaningless rendered on grey.

## The workflow

1. **`read_palette`** — the unique colours, how much each is used, and any edit set a person
   already saved into the file (`meta.themeStudio`: their layer names and groups). If that
   set is there, work with their names, not raw indices.
2. **`suggest_theme`** — the draft. Lightness flips in OKLCH so hues survive, brand colours
   are protected, gradients that fade to nothing take the backdrop, and it returns a WCAG
   audit plus a reason per colour. Treat it as a starting point to correct, not an answer.
3. **`render_preview`** with the proposed `edits` — before writing anything. Preview takes
   an edit set precisely so you can look before you commit.
4. Fix what is wrong, one colour at a time, previewing again.
5. **`apply_edits`** with `embed: true` — writes the file *and* stores the edit set inside
   it, so the next reader (you, later, or the person in the browser) sees what was done.

With a reference screenshot, insert **`sample_screenshot`** before step 2: it extracts the
dominant colours and proposes a mapping from the animation onto them, matched by how much
of the picture a colour covers rather than by lightness — a reference is usually the
opposite theme, so matching by lightness maps everything backwards.

## Never type a colour you read off a picture

This is the single most common way a conversion comes back *almost* right. An image shown
in a conversation has been rescaled and recompressed before you see it; the hex you read
from it is a shade or two from the one the designer chose, and a shade or two is exactly
what the person notices when the animation sits next to the real component.

- The reference must be a **file in the workspace**, passed to `sample_screenshot` by path.
  Its palette is read from the pixels, and every hex it returns is a value the image really
  contains — the most common exact pixel of each cluster, not the cluster's average.
- For one specific element — this button, that background — pass `x` and `y`. A flat area
  answers with its exact colour.
- If you already have colours in mind, from the brief or from a design token, pass them as
  `snap`. Each one comes back with the nearest colour the image actually has and the
  distance to it. **A distance under ~0.02 means you are about to write a near-miss: use
  the image's value.**
- The same goes for a colour the user names in words. "The green from the site" is not a
  hex; sample it.

## Work cheaply — every result is charged as tokens

A whole-file dump used to cost twenty thousand tokens a call, which is how a two-file job
turns into a long, expensive session. The defaults are now small; keep them that way.

- **`read_palette` first, always.** It is the complete picture of a file for a few hundred
  tokens: every colour, how much it is used, and any edit set a person already saved.
- **`layer_tree` only when the palette is not enough** — when you need to know *which*
  layer a colour is in. It returns three levels; raise `depth` for one specific branch
  rather than dumping the file.
- **`list_slots` filtered.** `hex` or `kind`, and a small `limit`. An unfiltered listing of
  a real file is thousands of tokens of things you will not edit. Ask for `describe` only
  when a slot is genuinely ambiguous.
- **`suggest_theme` returns role *counts*.** Add `explain: true` only when the draft looks
  wrong and you need to know why it chose what it chose.
- **`render_preview` is an image, and images are the most expensive result there is.**
  The default 384px shows a halo, a washed-out fill, a patch that did not change — that is
  what you are looking for. Render once when the plan is complete, not after every colour.
- **Verify with numbers, not with pictures.** `sample_screenshot` with `verify: <edits>`
  and `path` snaps every colour the animation would end up with onto the reference and
  tells you the distance. That catches a near-miss a render never will, for a fraction of
  the tokens.

Two calls — `read_palette`, then `apply_edits` — is a complete job for a simple file. Reach
for the rest when something is actually wrong.

## When a person has the editor open

If they are running `npx lottie-theme-sync`, you and they are in one session:

- **`session_state`** — which file they have open, the colour they have selected with the
  slot indices behind it, and every edit they have made but not saved. This is what makes
  "make *this* one white" a sentence you can act on: read the selection.
- **`push_edits`** — send a change into their editor without writing to disk. It appears
  instantly and lands in their undo stack, so they can reject it with one keystroke. While
  you are iterating this is the better tool: `apply_edits` is a commitment to the file.

`session_state` returning `connected: false` is not an error. Carry on with the files.

## The traps that decide whether the result is right

**Gradients are ramps, not loose colours.** `list_gradients` gives you each one whole:
its stops with positions and slot indices, its alpha ramp, and a `fadesOut` flag. Read a
gradient there rather than picking its stops out of `list_slots`, where three stops of one
ramp look like three unrelated colours.

Alpha lives in the same flat array as the colours, after the colour stops. A ramp reaching
zero is a *mask dissolving into the backdrop*, not a shape with a colour — invert it and
you get a dark halo around everything on a white page. The suggestion handles this; if you
are mapping by hand, give fading stops the new backdrop colour rather than an inverted one.
To move where a stop sits, use `positions` in the edit set (`{"positions": {"<ramp path>":
[0, 0.4, 1]}}`); the colours stay with their stops, so a position edit and a colour edit
never fight.

**Shared values.** A precomp referenced by ten layers is one JSON value walked ten times,
and an animated colour is one value across keyframes. `list_slots` marks these with a shared
`renderKey`: slots that share one cannot be given different colours. A file can have 110
slots and 11 editable colours. Do not promise to change one of ten and not the others.

**Prevalence is area, not count.** A background is often a single slot; text converted to
paths is a hundred small ones. Counting slots makes the text look like the dominant colour
and the theme comes back inverted in the wrong places. The core weighs by painted area —
another reason not to roll your own mapping.

**A near-black backdrop must not be inverted.** Inverting almost-black gives mid-grey, which
is why naively converted animations look faded. A backing shape covering most of the frame
takes the new page colour instead.

**Solid layers** keep their colour in `sc` as a `#rrggbb` string on the layer, not in the
shape tree. **Text** layers keep it in `t.d.k[].s.fc`. Both are easy to miss by hand; the
tool finds them.

**A glow of a colour that is nowhere in the palette is an effect.** A Drop Shadow carries
its own colour on the layer, outside the shape tree: `read_palette`, `list_slots` and
`layer_tree` are all blind to it. On the theme it was drawn for it is invisible; on the
other one it is a halo in a colour you cannot find. `list_effects` shows them with the path
to each, and the `effects` field of an edit set changes them. Check it whenever something
glows wrongly — and check the colour against what the layer itself is: a violet shadow
under a violet icon is the design, the same shadow under a teal badge is a leftover.

**Embedded bitmaps.** A quarter of real files carry PNGs inside the JSON, and they are dark
like everything else. They are recoloured by blending each pixel towards the mapped colours
by distance in OKLab — no threshold, so antialiased edges stay smooth — and alpha is never
touched. If an asset has more than ~32 colours (a photo), mapping it by name is meaningless:
invert its lightness or replace the file.

**Near-identical colours.** Exporters split one intended colour into `#17181D` and
`#17181E`. Map both, or the seam shows.

**Check more than one frame.** Layers come and go over time. `render_preview` takes a
`progress` (0..1) — look at the end as well as the start when anything animates in.

## Without the MCP server

The same core on the command line, for CI or a quick pass:

```bash
npx lottie-theme report animation.json                  # what colours are in it
npx lottie-theme suggest in.json out.json --save-theme theme.json
npx lottie-theme apply in.json out.json '#17181D=#FFFFFF' 12=f0f
npx lottie-theme batch lotties/ light/ --theme theme.json
```

`--embed` stores the edit set in the output, `--use-embedded` reads it back, and
`--reference <file>` refuses to apply index-addressed edits to a file whose slot structure
differs, falling back to the parts that travel. There is no renderer here — you are working
blind, so prefer the MCP server whenever a person will look at the result.

## Saying it is done

Say what you changed, what you deliberately left alone (protected brand colours, a photo
you did not map), and anything the WCAG audit still flags. If you never rendered it, say
that instead of implying you checked.
