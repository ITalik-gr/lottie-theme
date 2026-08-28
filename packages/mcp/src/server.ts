#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { closeBrowser, renderPreview } from './render.ts';
import {
  applyToDoc, effects, gradients, layerTree, listSlots, readPalette, recolorImage, sampleScreenshot,
  suggest, Workspace,
} from './tools.ts';
import { decodePng } from './image.ts';
import { sync } from './sync.ts';
import type { ThemeEdits } from '@lottie-theme/core';

/**
 * MCP server for Lottie theming.
 *
 * The point is that an agent works on the same file, through the same core, as the person
 * in the browser — and that it can *see* what it did. Without `render_preview` an agent
 * edits blind, which is precisely where gradient masks go wrong.
 */

const workspace = new Workspace(process.cwd());
const server = new McpServer({ name: 'lottie-theme', version: '0.1.0' });

const editsSchema = z
  .object({
    version: z.literal(1).default(1),
    byHex: z.record(z.string()).optional(),
    byIndex: z.record(z.string()).optional(),
    alpha: z.record(z.array(z.object({ position: z.number(), alpha: z.number() }))).optional(),
    positions: z
      .record(z.array(z.number()))
      .optional()
      .describe('Gradient ramp path → where its colour stops sit, 0..1 in ramp order.'),
    effects: z
      .record(z.string())
      .optional()
      .describe('Effect colour path (from list_effects) → colour. A drop shadow\'s own colour.'),
    names: z.record(z.string()).optional(),
    groups: z.record(z.array(z.number())).optional(),
  })
  .describe('An edit set: colour map, alpha ramps, layer names and groups.');

// Compact, not pretty-printed. Indentation is about a third of the characters in a
// large result and buys a model nothing — it reads JSON either way.
const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

server.registerTool(
  'list_slots',
  {
    description:
      'Every colour slot of an animation in layer z-order, with its stable index. Slots ' +
      'sharing a renderKey are the same JSON value seen more than once and cannot be given ' +
      'different colours.',
    inputSchema: {
      path: z.string().describe('Path to the .json animation, relative to the workspace.'),
      hex: z.string().optional().describe('Only slots of this colour.'),
      kind: z.string().optional().describe('fill, stroke, gradient-fill, solid-layer, text-fill…'),
      limit: z.number().optional().describe('Default 60. Filter by hex or kind before raising it.'),
      describe: z.boolean().optional().describe('Add a prose description per slot. Costly; rarely needed.'),
    },
  },
  async ({ path, hex, kind, limit, describe }) =>
    text(listSlots(await workspace.readDoc(path), { hex, kind, limit, describe })),
);

server.registerTool(
  'read_palette',
  {
    description:
      'Unique colours with usage counts, plus any edit set already saved into the file by ' +
      'a person working in the UI — layer names and groups included. Start here: it is the ' +
      'cheapest complete picture of a file.',
    inputSchema: {
      path: z.string(),
      slots: z.boolean().optional().describe('Include the slot indices behind each colour. Large.'),
    },
  },
  async ({ path, slots }) => text(readPalette(await workspace.readDoc(path), { slots })),
);

server.registerTool(
  'layer_tree',
  {
    description:
      'The document as a layer tree with each layer\'s slots, flagging reused precomps, ' +
      'masks, track mattes and raster image layers. Only the top three levels by default — ' +
      'a whole tree is thousands of tokens and read_palette usually answers the question.',
    inputSchema: {
      path: z.string(),
      depth: z.number().optional().describe('How deep to walk. Default 3.'),
      limit: z.number().optional().describe('Maximum rows. Default 150.'),
      verbose: z.boolean().optional().describe('Add layer ids and frame ranges.'),
    },
  },
  async ({ path, depth, limit, verbose }) =>
    text(layerTree(await workspace.readDoc(path), { depth, limit, verbose })),
);

server.registerTool(
  'list_gradients',
  {
    description:
      'Every gradient in the file as a ramp: its colour stops with positions and slot ' +
      'indices, its alpha ramp, and whether it fades to nothing. A gradient whose alpha ' +
      'reaches zero is a mask dissolving into the page — those stops take the backdrop ' +
      'colour, never an inverted one. Move stops with the `positions` field of an edit set; ' +
      'recolour them by their slot index.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => text(gradients(await workspace.readDoc(path))),
);

server.registerTool(
  'suggest_theme',
  {
    description:
      'Draft the opposite theme: roles are classified, lightness flips in OKLCH so hues ' +
      'survive, brand colours are protected, and gradients that fade to nothing take the ' +
      'backdrop. Returns the edit set and a WCAG audit; it does not write anything.',
    inputSchema: {
      path: z.string(),
      target: z.enum(['light', 'dark']).default('light'),
      backdrop: z.string().optional().describe('The colour the animation will sit on.'),
      explain: z
        .boolean()
        .optional()
        .describe('Return the role and reasoning for every colour, not just the counts. Large.'),
    },
  },
  async ({ path, target, backdrop, explain }) =>
    text(suggest(await workspace.readDoc(path), target, backdrop, { explain })),
);

server.registerTool(
  'apply_edits',
  {
    description:
      'Apply an edit set and write the result. Use embed to store the set in the file under ' +
      'meta.themeStudio, so the next reader — person or agent — sees what was done.',
    inputSchema: {
      path: z.string(),
      out: z.string().describe('Where to write. May be the same as path.'),
      edits: editsSchema,
      embed: z.boolean().default(true),
    },
  },
  async ({ path, out, edits, embed }) => {
    const result = applyToDoc(await workspace.readDoc(path), edits as ThemeEdits, embed);
    await workspace.writeDoc(out, result.doc);
    // If someone has the editor open on this file, they see the change immediately —
    // as an ordinary edit in their undo stack, not as the document swapped underneath them.
    const pushed = await sync.push(`agent: ${out}`, edits);
    return text({
      out,
      pushedToBrowser: pushed,
      colorsChanged: result.colorsChanged,
      rampsChanged: result.rampsChanged,
      namesChanged: result.namesChanged,
      totalSlots: result.totalSlots,
      unusedHex: result.unusedHex,
      unusedIndex: result.unusedIndex,
    });
  },
);

server.registerTool(
  'render_preview',
  {
    description:
      'Render the animation to a PNG so you can see the result of your own edit. Pass a ' +
      'background: a gradient that fades to transparent is meaningless without one. The ' +
      'default size is small on purpose — every pixel is tokens, and 384px is enough to see ' +
      'a halo or a washed-out fill. Raise it only to inspect something you have already found.',
    inputSchema: {
      path: z.string(),
      frame: z.number().optional(),
      progress: z.number().min(0).max(1).optional().describe('Position through the animation, 0..1.'),
      background: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      edits: editsSchema.optional().describe('Preview these edits without writing them.'),
    },
  },
  async ({ path, edits, ...options }) => {
    const doc = await workspace.readDoc(path);
    const preview = edits ? applyToDoc(doc, edits as ThemeEdits, false).doc : doc;
    const result = await renderPreview(preview, options);
    return {
      content: [
        { type: 'image' as const, data: result.base64, mimeType: 'image/png' },
        {
          type: 'text' as const,
          text: `frame ${result.frame} of ${result.totalFrames}, ${result.width}×${result.height}`,
        },
      ],
    };
  },
);

server.registerTool(
  'sample_screenshot',
  {
    description:
      'Read a reference image\'s colours. Every hex it returns is a value the image really ' +
      'contains, read from the pixels — never eyeball a colour off a picture you were shown ' +
      'and type it in, because a screenshot in a conversation has been rescaled and ' +
      'recompressed and the hex you read from it is a shade or two off. Returns the dominant ' +
      'colours with their share of the picture, and optionally: a mapping from an animation ' +
      'onto them (by how much of the picture a colour covers, not by lightness — a reference ' +
      'is usually the opposite theme), the colour at one pixel, and snap, which moves colours ' +
      'you already intend to use onto the nearest colour the image actually has.',
    inputSchema: {
      image: z.string().describe('Path to a PNG in the workspace.'),
      path: z.string().optional().describe('Animation to propose a mapping for.'),
      colors: z.number().optional(),
      x: z.number().optional().describe('Sample this exact pixel as well.'),
      y: z.number().optional(),
      snap: z
        .array(z.string())
        .optional()
        .describe(
          'Hexes you plan to use, checked against the image: each comes back with the nearest ' +
          'colour the image contains and the distance to it. Anything under ~0.02 is the same ' +
          'colour to the eye and a near-miss on the page — use the image\'s value.',
        ),
      verify: editsSchema
        .optional()
        .describe(
          'An edit set to check against the image, with path. Every colour the animation would ' +
          'end up with is snapped to the image the same way — the cheap way to catch a ' +
          'near-miss before writing the file, and before rendering anything.',
        ),
    },
  },
  async ({ image, path, colors, x, y, snap, verify }) =>
    text(
      await sampleScreenshot(workspace, image, decodePng, {
        colors,
        point: x !== undefined && y !== undefined ? { x, y } : undefined,
        doc: path ? await workspace.readDoc(path) : undefined,
        snap,
        verify: verify as ThemeEdits | undefined,
      }),
    ),
);


server.registerTool(
  'list_effects',
  {
    description:
      'Colours that sit on effects rather than in the shape tree — a Drop Shadow carries ' +
      'its own colour, and no palette, slot list or layer tree will ever show it. Check this ' +
      'whenever a converted file has a glow or halo of a colour you cannot find: it is ' +
      'invisible on the theme it was drawn for and obvious on the other one. Recolour one ' +
      'with the `effects` field of an edit set, keyed by the path returned here.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => text(effects(await workspace.readDoc(path))),
);

server.registerTool(
  'recolor_image',
  {
    description:
      'The bitmaps embedded in a file, and how to fix them. Called with only a path it ' +
      'reports each one: its size, the colours it is built from, and whether mapping it ' +
      'colour by colour is meaningful at all (a photograph is not — invert it instead). ' +
      'Give map or invert and out to write the result. Alpha is never touched, so a bitmap ' +
      'that doubles as a matte keeps working. A dark stripe or grain texture left behind by ' +
      'a theme conversion is the usual reason to reach for this: it is invisible on the ' +
      'theme it was drawn for and obvious on the other one.',
    inputSchema: {
      path: z.string(),
      out: z.string().optional().describe('Where to write. Required to change anything.'),
      index: z.number().optional().describe('One asset by index. Default: every bitmap.'),
      map: z.record(z.string()).optional().describe('Colour in the bitmap → colour to move it to.'),
      invert: z.boolean().optional().describe('Invert lightness instead — for a photograph.'),
      strength: z.number().optional().describe('0..1, how far to move each pixel. Default 1.'),
    },
  },
  async ({ path, out, index, map, invert, strength }) => {
    const result = await recolorImage(workspace, path, { index, map, invert, strength });
    const { doc, ...report } = result as { doc?: unknown } & Record<string, unknown>;
    if ((map || invert) && out && doc) await workspace.writeDoc(out, doc);
    return text({ ...report, ...(out && (map || invert) ? { out } : {}) });
  },
);

server.registerTool(
  'session_state',
  {
    description:
      'What the person at the editor currently has open, selected and changed — the file, ' +
      'their unsaved edit set, and the colour they have picked, with the slot indices behind ' +
      'it. Call this when the user says "this one" or "the colour I selected". Returns ' +
      'connected: false when nobody has the live bridge running, which is not an error.',
    inputSchema: {},
  },
  async () => {
    const state = await sync.state();
    if (!state.connected || !state.session) {
      return text({
        connected: false,
        reason: state.error,
        hint: 'Run `npx lottie-theme-sync` in this folder and open the editor to share a session.',
      });
    }
    const { path, edits, selection, activity, revision } = state.session;
    return text({
      connected: true,
      root: state.root,
      path,
      revision,
      selection,
      /** Unsaved: on disk the file is still as it was. */
      edits,
      activity: activity.slice(-20),
    });
  },
);

server.registerTool(
  'push_edits',
  {
    description:
      'Send an edit set to the open editor without writing anything to disk. The animation ' +
      'and palette redraw immediately and the step joins the user\'s undo stack, so they can ' +
      'reject it with one keystroke. Prefer this over apply_edits while iterating — it is a ' +
      'proposal the person can see; apply_edits is a commitment to the file.',
    inputSchema: {
      label: z.string().describe('Shown in the activity list: what this change is.'),
      edits: editsSchema,
    },
  },
  async ({ label, edits }) => {
    const pushed = await sync.push(label, edits);
    return text(
      pushed
        ? { pushed: true, label }
        : { pushed: false, reason: 'no editor is connected', hint: 'Run `npx lottie-theme-sync` and open the editor.' },
    );
  },
);

const shutdown = () => {
  sync.close();
  void closeBrowser().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await server.connect(new StdioServerTransport());
