'use client';

/**
 * A PNG of what is currently on the canvas.
 *
 * The agent has to see the result of its own edit. Reasoning about a colour map in the
 * abstract is exactly where gradient masks go wrong: a ramp that fades into the backdrop
 * reads as correct in the JSON and wrong on the page.
 */
export async function captureCanvas(background: string, size = 512): Promise<string | null> {
  const svg = document.querySelector<SVGSVGElement>('[data-canvas-host] svg');
  if (!svg) return null;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(size));
  clone.setAttribute('height', String(size));
  // The x-ray dimming is a UI affordance, not part of the artwork.
  for (const el of clone.querySelectorAll<SVGElement>('[style*="opacity"]')) {
    if (el.style.opacity === '0.1') el.style.opacity = '';
    el.style.filter = '';
  }

  const source = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, 0, 0, size, size);
      resolve(canvas.toDataURL('image/png').split(',')[1] ?? null);
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
