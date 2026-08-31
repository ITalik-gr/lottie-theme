'use client';

import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaToolRunContext } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
// The SDK's Zod helper targets the v4 schema types; zod 3.25 ships them under /v4.
import { z } from 'zod/v4';
import {
  buildLayerTree, buildPalette, collectProperties, describeSlot, listImageAssets,
  slotsInSubtree, suggestTheme, type ThemeEdits,
} from '@lottie-theme/core';
import { useEditor } from '@/lib/store';
import { captureCanvas } from './canvas';

/**
 * What the agent can do.
 *
 * Exactly the operations a person has in the UI, over the document that is open, going
 * through the same core. An edit made here lands in the same undo stack, so nothing the
 * agent does is outside what the user can inspect and reverse.
 */

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** What a tool call did, for the panel to show. A row that says only `apply_edits` tells
 *  nobody what was applied, and the whole point of watching an agent work is being able to
 *  disagree with it early. */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Text the model was handed back, or a note for a result that is a picture. */
  result: string;
}

/** A tool result as one line the panel can show without unfolding it. */
function summarise(result: string | Array<{ type: string }>): string {
  if (typeof result === 'string') return result;
  return result.map((block) => (block.type === 'image' ? '[a picture of the canvas]' : '')).join('\n');
}

const editsSchema = z.object({
  byHex: z.record(z.string(), z.string()).optional().describe('Source colour → target colour, applied everywhere it appears.'),
  byIndex: z.record(z.string(), z.string()).optional().describe('Slot index → colour, for one slot only.'),
  names: z.record(z.string(), z.string()).optional().describe('Layer path → name, written into the document.'),
  groups: z.record(z.string(), z.array(z.number())).optional(),
});

export function buildTools(onCall?: (call: ToolCall) => void) {
  const state = () => useEditor.getState();

  const readPalette = betaZodTool({
    name: 'read_palette',
    description:
      'The colours of the open animation with usage counts, plus how many are actually ' +
      'editable. Slots sharing a value are one colour: a precomp referenced by ten layers ' +
      'is one JSON object, and changing it changes all ten.',
    inputSchema: z.object({}),
    run: async () => {
      const { slots, currentId } = state();
      const properties = collectProperties(slots);
      return json({
        file: currentId,
        slots: slots.length,
        editable: properties.length,
        images: listImageAssets(state().original).length,
        colors: buildPalette(slots).map((e) => ({ hex: e.hex, count: e.count, kinds: e.kinds, slots: e.slots })),
      });
    },
  });

  const listSlots = betaZodTool({
    name: 'list_slots',
    description:
      'Colour slots in layer z-order with their stable indices, so you can target one ' +
      'exactly. Filter to keep the result small.',
    inputSchema: z.object({
      hex: z.string().optional().describe('Only slots of this colour.'),
      kind: z.string().optional().describe('fill, stroke, gradient-fill, solid-layer, text-fill…'),
      limit: z.number().optional().default(60),
    }),
    run: async ({ hex, kind, limit }) => {
      const matching = state().slots.filter(
        (s) => (!hex || s.hex.toUpperCase() === hex.toUpperCase()) && (!kind || s.kind === kind),
      );
      return json({
        matched: matching.length,
        slots: matching.slice(0, limit ?? 60).map((s) => ({
          index: s.index,
          hex: s.hex,
          kind: s.kind,
          description: describeSlot(s),
        })),
      });
    },
  });

  const layerTree = betaZodTool({
    name: 'layer_tree',
    description:
      'The layer structure, flagging reused precomps (shared colours), masks, track mattes ' +
      'and raster image layers. Use it to understand what a colour belongs to.',
    inputSchema: z.object({}),
    run: async () => {
      const { original, slots } = state();
      const rows: unknown[] = [];
      const walk = (nodes: ReturnType<typeof buildLayerTree>, depth: number) => {
        for (const node of nodes) {
          rows.push({
            depth,
            name: node.name,
            type: node.typeName,
            slots: node.slots,
            subtreeSlots: slotsInSubtree(node).length,
            shared: node.sharedPrecomp,
            mask: node.hasMask,
            matte: node.matte,
            image: node.imageAsset,
          });
          walk(node.children, depth + 1);
        }
      };
      walk(buildLayerTree(original, slots), 0);
      return json({ layers: rows.slice(0, 200) });
    },
  });

  const suggest = betaZodTool({
    name: 'suggest_theme',
    description:
      'Draft the opposite theme without applying it. Returns a colour map, a role per ' +
      'colour with the reasoning, and a contrast audit listing anything that would be ' +
      'invisible against the new background. A good starting point to then correct.',
    inputSchema: z.object({
      target: z.enum(['light', 'dark']).default('light'),
      backdrop: z.string().optional().describe('The colour the animation will sit on.'),
    }),
    run: async ({ target, backdrop }) => {
      const { original, slots, properties } = state();
      const result = suggestTheme(original, slots, properties, { target, backdrop });
      return json({
        edits: result.edits,
        roles: result.roles.map((r) => ({ hex: properties.find((p) => p.key === r.key)?.hex, role: r.role, reason: r.reason })),
        audit: result.audit,
      });
    },
  });

  const applyEdits = betaZodTool({
    name: 'apply_edits',
    description:
      'Apply a colour map to the open animation. It lands in the same undo stack as a ' +
      "person's edits, so it can be reversed. Look at the canvas afterwards.",
    inputSchema: z.object({
      edits: editsSchema,
      label: z.string().optional().describe('What this change is, for the undo history.'),
    }),
    run: async ({ edits, label }) => {
      const before = state().edits;
      state().applyEdits(label ?? 'agent edit', { version: 1, ...edits } as ThemeEdits);
      const after = state().edits;
      return json({
        applied: true,
        colours: Object.keys(after.byHex ?? {}).length,
        slots: Object.keys(after.byIndex ?? {}).length,
        previouslyMapped: Object.keys(before.byHex ?? {}).length,
      });
    },
  });

  const lookAtCanvas = betaZodTool({
    name: 'look_at_canvas',
    description:
      'A picture of the animation as it currently renders, on the chosen background. Use ' +
      'this after every change: a gradient that fades into the backdrop looks correct in ' +
      'the JSON and wrong on the page, and only the render shows it.',
    inputSchema: z.object({
      background: z.string().optional().describe('Backdrop to composite onto. Defaults to the canvas setting.'),
    }),
    run: async ({ background }) => {
      const base64 = await captureCanvas(background ?? state().background);
      if (!base64) return 'The canvas is not rendered right now.';
      return [
        { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: base64 } },
        { type: 'text' as const, text: `Rendered on ${background ?? state().background}.` },
      ];
    },
  });

  const tools = [readPalette, listSlots, layerTree, suggest, applyEdits, lookAtCanvas];
  if (!onCall) return tools;

  // Reporting is wrapped around the tools rather than written into each one: there are six
  // of them and the reporting has nothing to do with what any of them means.
  return tools.map((tool) => ({
    ...tool,
    run: async (args: never, context?: BetaToolRunContext) => {
      const result = await tool.run(args, context);
      onCall({
        id: context?.toolUse.id ?? tool.name,
        name: tool.name,
        input: args,
        result: summarise(result),
      });
      return result;
    },
  }));
}

export const SYSTEM_PROMPT = `You retheme Lottie animations inside a browser editor. The user has one animation open; your tools act on it.

How this format actually behaves, so you do not have to rediscover it:
- A slot is one occurrence of a colour. Slots sharing a value are the same JSON object — a precomp referenced ten times is one colour, and it cannot be split.
- A gradient's alpha ramp decides whether it is a shape or a mask. If the ramp reaches zero the gradient dissolves into whatever is behind it, and its stops should take the backdrop colour rather than being inverted. Inverting one is what leaves a dark halo on a light page.
- Lightness should be flipped perceptually, not by inverting RGB. Brand colours are better protected than flipped.
- Embedded bitmaps are dark too. Say so if you find them; the user recolours them in the images tab.

Work in small steps and look at the canvas after each one. Prefer by-hex edits, which apply everywhere a colour is used, over per-slot edits. Say what you changed and what you are unsure about; do not claim a result you have not looked at.`;
