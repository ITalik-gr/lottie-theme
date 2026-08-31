import type { EffectColor, ThemeEdits, TreeNode } from '@lottie-theme/core';

/** Effects whose colour lives on this layer object, not on a child precomp. */
export function effectsOnLayer(effects: readonly EffectColor[], node: TreeNode): EffectColor[] {
  const prefix = `${node.path.join('.')}.ef.`;
  return effects.filter((e) => e.path.startsWith(prefix));
}

export function effectHex(edits: ThemeEdits, effect: EffectColor): string {
  return edits.effects?.[effect.path] ?? effect.hex;
}

/** Effect opacity is 0..255 in the file; the panel talks in percent like After Effects. */
export function effectOpacityLabel(opacity: number | null): string | null {
  if (opacity === null) return null;
  return `${Math.round((opacity / 255) * 100)}%`;
}

/** Layer ids from the root down to the node that owns this property. */
export function ancestorIdsForProperty(
  tree: readonly TreeNode[],
  slots: readonly { renderKey?: string }[],
  key: string,
): string[] | null {
  const walk = (nodes: readonly TreeNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      const next = [...trail, node.id];
      if (node.slots.some((i) => slots[i]?.renderKey === key)) return next;
      const hit = walk(node.children, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, []);
}

/** Layer ids from the root down to the layer that carries this effect path. */
export function ancestorIdsForEffect(tree: readonly TreeNode[], effectPath: string): string[] | null {
  const walk = (nodes: readonly TreeNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      const next = [...trail, node.id];
      if (effectPath.startsWith(`${node.path.join('.')}.ef.`)) return next;
      const hit = walk(node.children, next);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, []);
}
