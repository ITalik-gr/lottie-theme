import type { Slot } from '@lottie-theme/core';

/**
 * The most specific name a human would recognise for a colour's owner.
 *
 * The nearest named layer, falling back to a named shape group, and only then to the
 * layer's type and index. Exports strip `nm` constantly, so this has to degrade
 * gracefully rather than print `fl` — which is what the inspector used to do, leaving
 * the panel headed by two letters that mean nothing to anyone.
 *
 * Shared by the hit-stack popover and the inspector on purpose: the thing you clicked
 * has to be called the same name in the list you picked it from and in the panel it
 * lands in, or they do not obviously refer to each other.
 */
export function describeTarget(slot: Slot): string {
  for (let i = slot.layerTrail.length - 1; i >= 0; i--) {
    const name = slot.layerTrail[i]!.name;
    if (name) return name;
  }
  const namedShape = [...slot.shapeTrail].reverse().find((n) => n && !/^(fl|st|gf|gs|gr|sh|rc|el|tr)$/.test(n));
  if (namedShape) return namedShape;
  const own = slot.layerTrail[slot.layerTrail.length - 1];
  return own ? `layer ${own.ind ?? '?'}` : 'unnamed';
}
