import { chromium, type Browser } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Rendering a Lottie to a PNG, headless.
 *
 * This is the tool that matters most for an agent: without seeing the result of its own
 * edit it works blind, and blind is exactly where gradient masks go wrong — a ramp that
 * fades into the backdrop looks fine in the JSON and wrong on the page.
 *
 * A real browser rather than node-canvas: lottie-web's SVG renderer is the one whose
 * output the web app and every consumer actually uses, and reproducing its masking and
 * gradient behaviour outside a browser is not worth the divergence. The cost is a Chrome
 * on the machine, which is reused across calls rather than launched per render.
 */

let browser: Browser | null = null;
let lottieSource: string | null = null;

/** Chrome lookup order: an explicit override, then the usual per-platform locations. */
function chromePath(): string | undefined {
  if (process.env.LOTTIE_THEME_CHROME) return process.env.LOTTIE_THEME_CHROME;
  const candidates: Record<string, string> = {
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    linux: '/usr/bin/google-chrome',
    win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  };
  return candidates[process.platform];
}

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = null;
}

async function getLottie(): Promise<string> {
  if (lottieSource) return lottieSource;
  const here = dirname(fileURLToPath(import.meta.url));
  lottieSource = await readFile(resolve(here, '../../../vendor/lottie.min.js'), 'utf8');
  return lottieSource;
}

export interface RenderOptions {
  /** 0..1 through the animation, or an absolute frame with `frame`. */
  progress?: number;
  frame?: number;
  width?: number;
  height?: number;
  /** Backdrop to composite onto — a fading gradient is meaningless without one. */
  background?: string;
}

export interface RenderResult {
  /** Base64 PNG, ready to hand to a model as an image. */
  base64: string;
  width: number;
  height: number;
  frame: number;
  totalFrames: number;
}

export async function renderPreview(doc: unknown, options: RenderOptions = {}): Promise<RenderResult> {
  // Small by default: the image is charged as tokens on every call, and the failures
  // this exists to catch — a dark halo, a washed-out fill, a patch that did not change —
  // are all visible at this size.
  const width = options.width ?? 384;
  const height = options.height ?? 384;
  const page = await (await getBrowser()).newPage({
    viewport: { width, height },
    // 1, not 2: a retina render doubles the pixels and the token cost of the result
    // without showing a model anything it could not already see.
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(
      `<body style="margin:0;background:${options.background ?? '#FFFFFF'}">
         <div id="a" style="width:${width}px;height:${height}px"></div></body>`,
    );
    await page.addScriptTag({ content: await getLottie() });

    const info = await page.evaluate(
      ([animationData, progress, frame]) => {
        const anim = (window as unknown as { lottie: any }).lottie.loadAnimation({
          container: document.getElementById('a'),
          renderer: 'svg',
          autoplay: false,
          animationData,
        });
        const total = anim.totalFrames;
        const at = frame !== null ? frame : Math.floor(total * (progress as number));
        anim.goToAndStop(Math.max(0, Math.min(total - 1, at)), true);
        return { frame: Math.round(anim.currentFrame), totalFrames: Math.round(total) };
      },
      [doc, options.progress ?? 0.5, options.frame ?? null] as const,
    );

    const shot = await page.locator('#a').screenshot({ type: 'png' });
    return { base64: shot.toString('base64'), width, height, ...info };
  } finally {
    await page.close();
  }
}
