# Lottie Theme

Turn a dark-theme Lottie animation into a light one, or the other way round, without After
Effects.

**[lottie.italik.dev](https://lottie.italik.dev)** — runs entirely in your browser. Nothing
is uploaded and there is no account to make.

| dark, as it shipped | light, converted here |
| --- | --- |
| ![dark](examples/card.dark.png) | ![light](examples/card.light.png) |
| ![dark](examples/badge.dark.png) | ![light](examples/badge.light.png) |

## Why it exists

The source `.aep` is usually gone, the exporter scattered colour across eight different
shapes of JSON, and "invert the lightness" produces washed-out grey and dark halos.

Both examples above started from `suggest_theme` and neither was finished by it. The
progress bar carries a striped PNG baked into the file — invisible on a dark page, a grey
hatch spilling past the rounded track on a white one. The badge's glow is a colour on a
Drop Shadow effect, which no palette lists. Rendering the result is how both were found.

## Three ways to use it

| | what it is for |
| --- | --- |
| **[The editor](https://lottie.italik.dev)** | one animation, by eye. Click a shape, see every colour under the pointer, recolour it. |
| **The CLI** | a folder of them, or CI. Work the theme out once, apply that edit set to all. |
| **An MCP server** | an agent that can *look* at what it rendered, and reach the colours no palette shows. |

All three are thin shells over `packages/core`. Nothing about how a colour is found or
changed is implemented twice, so a file edited by hand and one edited by a script come out
identical.

## Install

Needs Node 22.18+ and pnpm.

```bash
pnpm install
pnpm dev          # the editor on http://localhost:3000
pnpm test         # core unit tests + parity against the Python PoC
pnpm typecheck
pnpm smoke        # headless browser check; needs `pnpm dev` running
```

`pnpm smoke` drives the running app through the system Chrome and checks what unit tests
cannot: that lottie-web mounts an SVG, that a palette edit reaches the canvas, that
dragging a gradient stop reaches the rendered SVG, and that undo restores it.

Bring your own animations — drop them on the page, or put them in `lotties/`, which is
gitignored. Tests that walk that folder skip themselves when it is absent, so a fresh clone
is green without it.

## Command line

```bash
lottie-theme report lotties/**/*.json          # colours in each file
lottie-theme list animation.json               # every slot, with its index
lottie-theme apply in.json out.json '#17181D=#FFFFFF' 12=f0f
lottie-theme suggest in.json out.json --save-theme theme.json
lottie-theme batch lotties/ light/ --theme theme.json
```

`--embed` writes the edit set into the output under `meta.themeStudio`; players ignore
fields they do not know, so the file keeps working while carrying its own colour map.
`--use-embedded` reads it back. `--reference <file>` refuses to apply position-addressed
edits to a document whose slot structure differs, falling back to the by-hex parts.

## With an AI agent

The editor is complete on its own. An agent is what makes the *rest* of a file reachable:
it can look at the render it just produced, and it can change colours no palette lists.

Clone the repository and open it with an MCP-capable agent. Claude Code needs no setup —
`.mcp.json` points at the local server and the `lottie-theming` skill carries the workflow
and the traps that took a corpus of 53 files to learn. For anything else:

```jsonc
// .mcp.json
{ "mcpServers": { "lottie-theme": { "command": "npx", "args": ["-y", "lottie-theme-mcp"] } } }
```

<details>
<summary><b>The tools</b></summary>

| tool | what it is for |
| --- | --- |
| `read_palette` | every colour with usage counts, and any edit set saved in the file. Start here. |
| `list_slots` | individual colour slots, filtered by hex or kind |
| `layer_tree` | the document as layers, three levels deep by default |
| `list_gradients` | each gradient whole: stops, positions, alpha ramp, and whether it fades out |
| `list_effects` | colours carried by effects — a drop shadow's own colour |
| `suggest_theme` | the opposite theme as a draft, with a WCAG audit |
| `sample_screenshot` | exact colours of a reference image; `snap` and `verify` check yours against it |
| `recolor_image` | embedded bitmaps: what they are made of, and recolouring them |
| `apply_edits` | apply an edit set and write the file |
| `render_preview` | render it and look |
| `session_state`, `push_edits` | the live bridge to an open editor |

Results are deliberately small — a whole-file dump used to cost twenty thousand tokens a
call. The full form of each is behind a flag (`depth`, `describe`, `explain`, `slots`).

`render_preview` is the one that matters. Without seeing the result of its own edit an
agent works blind, and blind is exactly where gradient masks go wrong: a ramp that fades
into the backdrop looks correct in the JSON and wrong on the page. It renders through the
system Chrome, reused across calls; set `LOTTIE_THEME_CHROME` if it is somewhere unusual.

Every path is confined to the working directory, so an agent cannot read or overwrite files
elsewhere because something told it to.

</details>

<details>
<summary><b>In the browser, with your own key</b></summary>

The `agent` tab takes your own Anthropic API key and works on the open animation by
description — "make a light version and check it on white", "the glow around the badge
still looks dark, fix just that". Requests go from the page straight to the provider; there
is no backend here to route them through, which is the same reason your files never leave
the browser. The key is stored in that browser and nowhere else. The endpoint can be
pointed at a gateway that speaks the Anthropic API.

It is your account being billed, so the panel is built to be interruptible and to say what
it costs: a running estimate that counts cache reads and writes as well as plain tokens, a
spend ceiling per instruction that stops and asks rather than continuing quietly, a Stop
button, and a conversation whose prefix is cached and whose stale tool results are dropped
between turns — without which a single "make this light" ran to a few dollars.

Effort is the lever worth reaching for before the model: most recolouring does not need the
depth that a gradient fading into the backdrop does, and it is billed by the token.

</details>

<details>
<summary><b>Agent and editor on the same file</b></summary>

```bash
npx lottie-theme-sync        # in the same folder your agent's MCP server runs in
pnpm dev                     # the editor picks the bridge up on its own
```

What travels between them is the *edit set*, never the animation — so an agent's change
arrives in the browser the way a click does, lands in the same undo stack, and can be
rejected with `revert` on that one step.

- The agent sees the file you have open, the colour you have selected and the slot indices
  behind it (`session_state`), which is what makes "make *this* one white" actionable.
- It can propose a change you watch appear (`push_edits`) instead of writing the file and
  asking you to reload; `apply_edits` still writes, and the editor updates as it does.
- Nothing reaches disk until you press **write changes to the file**. Autosave would rewrite
  your sources while you experiment, and buy nothing: the agent already sees your unsaved
  work through the session.
- If a file changes underneath the editor, it says so and offers to reload rather than
  quietly diverging.

The bridge binds to loopback and exists only in development. The shipped build has no socket
to open.

</details>

## Working on a whole folder

Dropping files on the page is enough for one animation. For a folder — the case this was
built for — point the tools at it instead, and the file list, the batch panel, the live
bridge and an agent all address the same files by the same names.

```bash
# apps/web/.env.local
LOTTIE_WORKSPACE=/Users/you/work/brand-animations   # default: the repository root
LOTTIE_DIRS=source,converted                        # default: lotties,lotties-light
```

Converting it is two commands — work the theme out on one animation, then apply that one
edit set to all of them:

```bash
node packages/cli/src/cli.ts suggest source/hero.json converted/hero.json \
  --save-theme light.theme.json
node packages/cli/src/cli.ts batch source converted --theme light.theme.json
```

<details>
<summary><b>Why there is exactly one workspace root</b></summary>

A file's identity in the editor *is* its path relative to `LOTTIE_WORKSPACE`: the browser
sends that path to the sync hub, and the hub resolves it against its own root. Two roots
that disagree is two tools confidently editing different files, so `pnpm sync` and the MCP
server read the same variable rather than each defaulting to wherever they were started.

`LOTTIE_DIRS` picks which folders inside it to list. A listed folder that does not exist is
skipped, and the file panel says which ones it looked for, so a wrong path does not read as
an empty folder.

None of this reaches the deployed app, which has no server and cannot read a disk. The local
folder bridge (`app/api/local/route.dev.ts`) is excluded from the production build.

</details>

## How Lottie stores colour

Poorly documented elsewhere, so, briefly — `@lottie-theme/core` addresses all of it:

| where | shape | notes |
| --- | --- | --- |
| solid fill / stroke | `fl` / `st` → `c.k` | three numbers, 0..1 |
| animated fill / stroke | `c.k[i].s` and `.e` | one colour per keyframe end |
| gradient | `gf` / `gs` → `g.k.k` | flat array: `p` colour stops of `pos,r,g,b`… |
| gradient alpha ramp | same array, after `p * 4` | pairs of `pos,alpha` — without these a gradient cannot be read correctly |
| animated gradient | `g.k.k[i].s` | the whole ramp is keyframed |
| solid layer | layer `ty:1` → `sc` | a `#rrggbb` **string**, outside the shape tree |
| text | `t.d.k[i].s.fc` / `.sc` | separate from `fl`; often converted to paths on export |
| effect colour | layer `ef[].ef[]` with `ty:2` → `v.k` | a Drop Shadow's own colour; no palette built from fills and strokes will ever show it |
| raster image | `assets[].p` | a data URI when embedded; dark bitmaps are why a converted file still has dark patches |

A colour slot is addressed by a serialisable path plus an offset, and slots are numbered in
layer z-order (`layers` → `assets` recursively). That ordering is the contract that keeps
slot indices stable, so a saved colour map still applies after a re-import.
`packages/core/test/parity.test.ts` locks it against the Python PoC over the whole corpus.

## Layout

```
packages/core   @lottie-theme/core — all the logic, no UI dependencies
packages/cli    lottie-theme — the same logic on the command line
packages/mcp    an MCP server, so an AI agent edits through the same core
packages/sync   the live bridge between the editor and a local agent (development only)
apps/web        Next.js app (App Router, Tailwind, shadcn/ui, Zustand, lottie-web)
tools/colors.py the original Python proof of concept, kept as the parity reference
lotties/        animations to work on — gitignored, bring your own
scripts/        headless smoke test of the editor
```

## Not done yet

Deliberately, and in roughly this order:

- **Selecting on the canvas should select in the layer tree.** Clicking a shape fills the
  slot panel, but the tree does not move to it or expand to reveal it.
- **Shadows should be first-class in the editor.** Effect colours are reachable from the
  core, the CLI and the MCP server, but the browser cannot see them — they are addressed by
  path and the palette is built from slots.
- **Re-check `sync` and `agent` end to end.** Both were built early and have not been
  exercised since the gradient, effect and bitmap work landed.
- Adding and removing gradient stops (positions and colours move today; the count is fixed).
- `packages/sync`'s hub test is timing-sensitive: it watches a file and waits a second for
  the event, and fails under load. It wants a deterministic clock, not a longer wait.
- A published npm build of `@lottie-theme/core`, which is consumed as TypeScript source.

## Deployment

A static Next.js app with no backend. On Vercel, point the project at this repository and
set **Root Directory** to `apps/web`; the preset handles the rest and no environment
variables are needed. Do not override the output directory — with a root directory set,
Vercel resolves it relative to that, and `apps/web/.next` becomes `apps/web/apps/web/.next`.

## Licence

MIT. Built by [italik.dev](https://www.italik.dev/?ref=lottie-editor).
