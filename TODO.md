# Backlog

What is wrong and what fixes it. Each entry names the code that causes the behaviour, so the
diagnosis does not have to be redone. Ordered roughly by how much it hurts.

The list in `README.md` under "Not done yet" is the older, coarser version of this and stays
the public-facing summary; this file is the working list.

---

## 1. Dropping two files with the same name keeps only one — done

`filesFromInput` built the id from the path alone (`upload:<name>`), and `addFiles` drops any
file whose id is already known. Two unrelated `data.json` files were therefore one file, and
the second silently replaced nothing — it just never appeared.

The id now carries a hash of the file's contents: `upload:<path>#<hash>`. Two files with the
same name are two ids; the *same* file dropped twice is still one id, which is what makes it
pick its saved edits back up instead of starting blank. The tree disambiguates identical
labels within a folder with a `(2)` suffix.

## 2. The canvas did not accept a drop — done

The empty state said "Drop a Lottie JSON" and had no `onDrop`. Only the file tree took drops.

A drop now works anywhere over the centre column, and the whole area shows a target while a
file is over it. Files that are not JSON, and JSON that does not parse, report why instead of
being skipped in silence.

## 3. No warning before leaving with unsaved work — done

Nothing in the app listened for `beforeunload`. A reload threw away the undo stack and, in a
production build, the dropped documents with it (see 11).

`useUnloadGuard` now asks for confirmation when there are edits that have not been exported,
or while the agent is mid-run.

## 4. The agent cost far more than the work was worth — done

A single "convert this to a light theme" run billed about $3. Three causes, in order of size:

- **No prompt caching.** Every iteration of the tool loop re-sent the entire conversation at
  full price. With ten tool calls and results the size of `layer_tree`, that is a few hundred
  thousand input tokens for one request.
- **Nothing was ever dropped from the context.** Three `list_slots` dumps and every canvas
  screenshot stayed in the history and were paid for again on each following turn.
- **No ceiling.** The loop ran until the model stopped.

Fixed with a cache breakpoint on the system prompt (which covers the tool definitions, since
caching matches a prefix and tools are rendered first) and a second one that moves to the end
of the conversation each iteration; `clear_tool_uses_20250919` context management; an
iteration cap; and a spend ceiling that stops and asks rather than continuing quietly.

The cost readout was also wrong — it counted `input_tokens` only, which excludes both cache
reads and cache writes, so it under-reported. It now counts all four token classes at the
selected model's own prices.

## 5. The agent could not be stopped — done

`send()` consumed the runner's async iterator with no way out. The Stop button now aborts
through an `AbortSignal`, and the partial conversation is kept so the next turn continues
from it rather than restarting.

---

## 6. The folder of animations was one person's checkout — done

The CLI took any directory, the MCP server used its own working directory and the sync hub
took `--root`, but the editor's dev bridge had `lotties` and `lotties-light` written into
it, resolved two levels above `apps/web`. Anyone else cloning this got an empty file list
and nothing saying why.

Worse, the three that *were* generic agreed only by accident. A file's identity in the
editor is its path relative to a root, and the browser sends that path to the sync hub,
which resolves it against *its* root — so two roots that disagree is two tools editing
different files while both report success.

There is now one root, `LOTTIE_WORKSPACE`, read by the dev server, the hub and the MCP
server, with `LOTTIE_DIRS` choosing the folders inside it to browse. Defaults are the old
values, so an existing checkout behaves as before. Reading is confined to the browsed
folders rather than the whole root, and the file panel names the folders it looked in when
it finds none — a wrong path used to be indistinguishable from an empty one.

Documented in `README.md` (§ Working on a whole folder), `apps/web/.env.example`,
`CLAUDE.md` and the `lottie-theming` skill, so a person and an agent are told the same
thing. `.env*.local` is gitignored, which it was not.

Follow-up worth doing: the editor knows its own root and, from the hub probe, the hub's.
When they differ it should say so in the sync panel instead of quietly addressing the wrong
tree — the failure this was all about.

## 7. The agent panel was not really a chat — done

Assistant turns rendered as bare text with no bubble, tool calls as a one-line name with no
arguments or result, and there was no send button — Enter was the only way in. Thinking was
a spinner pinned under the log rather than part of it, and on this model it would have shown
a pause with nothing in it either way: `display` defaults to omitted, so the reasoning
arrives as empty blocks unless you ask for the summary.

Now: a bubble for what you said and plain text for the reply, streamed reasoning above it,
a Send button that becomes Stop while running, and tool calls as rows that unfold to show
the arguments and the result the model was actually handed — `apply_edits` on its own never
said what was applied. Plus clear-conversation, a token breakdown behind the cost, and
autoscroll only when the log is already at the bottom, so reading back through a run is not
dragged away on every token.

## 8. Choosing a model — done, except the second provider

`MODEL` was a constant and there was one key under one localStorage entry.

Now a model picker (Opus 5 / Sonnet 5 / Haiku 4.5) carrying each model's own prices into the
cost readout, an effort control (`output_config.effort` — the lever to reach for before
changing model, since routine recolouring does not need the depth a gradient does), an
adjustable spend ceiling, and an endpoint override for a gateway or proxy that speaks the
Anthropic API.

Still to do: an adapter for OpenAI-compatible endpoints (OpenRouter, Groq, a local server).
That one is not a setting. It is a manual tool loop behind a shared `runAgent()` interface,
with `lib/ai/tools.ts` split into a description of the tools and a binding to a particular
SDK, and it costs about as much to build as everything above it in this list.

## 9. The reference panel matched colours badly — done

Not a UI problem. `matchPalettes` in `packages/core/src/sample.ts` paired colours by how
much of the picture each covered, and nothing else could outweigh that: a green, a blue and
a teal — the three rarest colours of the animation — all landed on `#000000`, the rarest
colour of the screenshot.

Lightness stays out of it, and the comment saying why was right: the point of a reference is
usually that it is the opposite theme, so pairing dark with dark reproduces exactly what the
user is trying to escape. Three other things were wrong.

- **Greys and colours are now ranked separately**, and a colour looks for its match among
  the reference's colours. Prominence stays the ordering principle without being allowed to
  pair things that have nothing to do with each other. Crossing over is still possible when
  the reference has no colour at all — a grey screenshot can still theme an animation.
- **A wrong hue can now cost enough to matter.** It was spread linearly over half a turn, so
  a completely wrong hue could never push confidence below 0.65. It saturates at a quarter
  turn: green against blue is not "60% wrong", it is a different colour.
- **Sources are settled best-match-first, not most-prominent-first.** Reuse is discouraged,
  so whoever chooses first takes the good target — and in prominence order a green with no
  counterpart anywhere claimed the reference's only blue, leaving the animation's actual
  blue with a pale lavender.

Pairs now carry `weak` when the reference had nothing close. Every source colour is still
returned — the contract that nothing goes missing is worth keeping — but "apply all" applies
only the confident ones and says how many it left, since sweeping the guesses in with the
rest is what did the damage.

Verified on the case from the report: the blue finds the blue at 77%, the greens are
returned as the guesses they are, and no accent is turned into black.

## 10. The reference panel does not explain itself

Even fixed, the flow is unclear: drop a screenshot, pick colours, apply — none of it is
stated, and there is no way to reject one pair out of nine.

- Three visible steps.
- A checkbox per pair. Weak pairs are excluded from "apply all" and faded already (see 9),
  but there is still no way to reject a *confident* one you disagree with.
- Hovering a pair already highlights it on the canvas, but nothing says so.
- Reset the mapping; a real drop target for the image; a larger preview to pick from.

## 11. Nothing but the edits survives a reload

localStorage holds the edit sets, the file and folder aliases, the last open file and the
background. It does not hold the documents. In `next dev` this is invisible because the
corpus is re-read from disk, but in the deployed app a reload leaves `restoreId` pointing at
a file that is no longer in memory: the edits survive as orphans and the animation has to be
dropped again.

- IndexedDB for the documents themselves — megabytes, so localStorage cannot hold them.
- The same store for the agent conversation, the reference image, and the panel state
  (section, x-ray, checkerboard).
- Somewhere to see how much is stored and to forget one file.

## 12. Publish `@lottie-theme/core` to npm

It is consumed as TypeScript source today, which is why imports carry explicit `.ts`
extensions and why `erasableSyntaxOnly` is on. That works inside this repository and nowhere
else.

- A build that emits ESM plus declarations, with the `.ts` specifiers rewritten.
- `exports`, `files`, `types`, `sideEffects` in the manifest; a licence and a readme aimed at
  someone who has never seen this repository.
- Decide whether `cli`, `mcp` and `web` consume the published package or keep consuming the
  source. Keeping the source for the workspace is simpler and keeps the one architectural
  rule intact.
- Version and publish from CI on a tag, not from a laptop.

## 13. Carried over from the README

- Selecting on the canvas should select in the layer tree, and scroll the row into view.
- Shadows as first-class colours in the editor. Effect colours are reachable from the core,
  the CLI and the MCP server, but not from the browser palette, which is built from slots.
- Re-check `sync` and `agent` end to end. Both were built before the gradient, effect and
  bitmap work landed, and the edit set has grown three fields since.
- Adding and removing gradient stops; today the count is fixed.
- `packages/sync`'s hub test watches a file and waits a second for the event. It wants a
  deterministic clock, not a longer wait.
