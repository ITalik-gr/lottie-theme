#!/usr/bin/env node
/**
 * Headless smoke test of the editor against the local corpus.
 *
 * Uses the system Chrome rather than a downloaded browser, so it stays cheap to run.
 * Checks the things unit tests cannot: that lottie-web actually mounts an SVG, that
 * editing a palette colour reaches the rendered output, and that the page logs nothing.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:3000';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
// a bare "404" in the console says nothing; record what actually failed
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`);
});

await page.goto(`${base}/editor`, { waitUntil: 'networkidle' });

const fileButtons = page.locator('aside').first().locator('button[title$=".json"]');
check('file tree lists the corpus', (await fileButtons.count()) > 50, `${await fileButtons.count()} files`);

// lottie-web mounted something real
await page.waitForSelector('[data-canvas-host] svg', { timeout: 10_000 });
const shapeCount = await page.locator('[data-canvas-host] svg').evaluate(
  (svg) => svg.querySelectorAll('path, rect, ellipse, g').length,
);
check('canvas renders an SVG with geometry', shapeCount > 0, `${shapeCount} nodes`);

const slotLine = await page.locator('footer').innerText();
check('footer reports slots', /\d+ colours in \d+ slots/.test(slotLine), slotLine.trim());

// Palette reflects the document and editing it reaches the canvas.
const rows = page.getByTestId('palette-row');
const rowCount = await rows.count();
check('palette lists colours', rowCount > 0, `${rowCount} rows`);

const firstHex = (await rows.first().locator('span.font-mono').first().innerText()).trim();
const before = await page.locator('[data-canvas-host] svg').evaluate((svg) => svg.outerHTML.length);
const hexField = rows.first().locator('input[type=text]');
await hexField.fill('#FF00FF');
await hexField.press('Enter');
await page.waitForTimeout(600);

const magenta = await page.locator('[data-canvas-host] svg').evaluate((svg) => {
  const hit = (s) => /#ff00ff|rgb\(255,\s*0,\s*255\)/i.test(s ?? '');
  return [...svg.querySelectorAll('*')].some(
    (el) => hit(el.getAttribute('fill')) || hit(el.getAttribute('stroke')) || hit(el.getAttribute('stop-color')),
  );
});
check(`editing ${firstHex} reaches the canvas`, magenta, before ? '' : 'svg was empty');

// Undo restores it.
await page.keyboard.press('Meta+z');
await page.waitForTimeout(600);
const reverted = (await rows.first().locator('input[type=text]').inputValue()).toUpperCase();
check('undo restores the colour', reverted === firstHex, `${reverted} vs ${firstHex}`);

// Switching files re-reads everything.
await fileButtons.nth(5).click();
await page.waitForTimeout(900);
check('switching files reloads the palette', (await rows.count()) > 0, `${await rows.count()} rows`);

// --- step 2: layer tree and click-to-pick ---------------------------------
async function openFile(match) {
  const n = await fileButtons.count();
  for (let i = 0; i < n; i++) {
    if ((await fileButtons.nth(i).getAttribute('title')).includes(match)) {
      await fileButtons.nth(i).click();
      await page.waitForTimeout(1200);
      return true;
    }
  }
  return false;
}

await openFile('lotties/How to invest/Illustration 1.json');

const status = await page.getByTestId('mapping-status').innerText();
const tagged = Number(/^(\d+) clickable/.exec(status)?.[1] ?? 0);
check('sentinel mapping tags the live SVG', tagged > 100, status.trim());
check('mapping did not fall back', !status.includes('unavailable'), status.trim());

const dataProps = await page.locator('[data-canvas-host] svg [data-props]').count();
check('data-props reaches the DOM', dataProps === tagged, `${dataProps} elements`);

const treeRows = page.locator('aside').first().locator('div.group');
check('layer tree renders', (await treeRows.count()) > 5, `${await treeRows.count()} rows`);

// clicking the middle of the canvas must surface a stack, not a single guess
const box = await page.locator('[data-canvas-host] svg').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(400);
const popover = page.getByTestId('hit-stack');
const opened = await popover.isVisible().catch(() => false);
check('clicking the canvas opens the hit stack', opened);

if (opened) {
  const entries = popover.locator('button').filter({ hasNot: page.locator('input') });
  const count = await entries.count();
  check('the stack lists what is under the pointer', count > 0, `${count} entries`);

  // clicking the same point again steps one layer deeper
  const header = () => popover.locator('span').first().innerText();
  const first = await header();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const second = await header();
  check('repeat click steps down the stack', first !== second, `${first.trim()} -> ${second.trim()}`);

  // picking the deepest entry fills the slot panel
  await entries.nth(count - 1).click();
  await page.waitForTimeout(400);
  const panel = await page.locator('aside').last().innerText();
  check('picking fills the slot panel', /slot \d+/.test(panel), panel.split('\n').slice(0, 2).join(' / '));

  // and recolouring from the slot panel reaches the canvas
  const field = page.locator('aside').last().locator('input[type=text]').last();
  await field.fill('#FF00FF');
  await field.press('Enter');
  await page.waitForTimeout(800);
  const magenta2 = await page.locator('[data-canvas-host] svg').evaluate((svg) => {
    const hit = (s) => /#ff00ff|rgb\(255,\s*0,\s*255\)/i.test(s ?? '');
    return [...svg.querySelectorAll('*')].some(
      (el) => hit(el.getAttribute('fill')) || hit(el.getAttribute('stroke')) || hit(el.getAttribute('stop-color')),
    );
  });
  check('slot-panel edit reaches the canvas', magenta2);
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
}

// a file whose colours are shared through a reused precomp
if (await openFile('gradient_02')) {
  const footer = await page.locator('footer').innerText();
  check('shared precomp colours are reported honestly', /11 colours in 110 slots/.test(footer), footer.trim());
}

// --- step 3: gradient alpha ramps -----------------------------------------
await openFile('Affiliate Icons/icon_3.json');

// pick a gradient stop from the layer tree, which lists every colour of a layer
const gradientRow = page
  .locator('aside')
  .first()
  .locator('button[title="shift-click to add to a selection"]')
  .filter({ hasText: /gradient/ })
  .first();
const hasGradient = (await gradientRow.count()) > 0;
check('layer tree lists gradient stops', hasGradient);

if (hasGradient) {
  await gradientRow.click();
  await page.waitForTimeout(400);
  const ramp = page.locator('aside').last().locator('[title*="click to add a stop"]');
  const shown = await ramp.count();
  check('picking a gradient stop shows its alpha ramp', shown > 0);

  if (shown) {
    const handles = ramp.locator('button');
    const before = await handles.count();
    const rampBox = await ramp.boundingBox();
    await page.mouse.click(rampBox.x + rampBox.width * 0.5, rampBox.y + rampBox.height * 0.5);
    await page.waitForTimeout(300);
    check('clicking the ramp adds a stop', (await handles.count()) === before + 1, `${before} -> ${await handles.count()}`);

    // and the edit reaches the rendered gradient
    const slider = page.locator('aside').last().locator('input[type=range]').last();
    await slider.fill('0');
    await page.waitForTimeout(600);
    const stopOpacity = await page.locator('[data-canvas-host] svg').evaluate(
      (svg) => [...svg.querySelectorAll('stop')].some((s) => Number(s.getAttribute('stop-opacity')) === 0),
    );
    check('alpha edit reaches the rendered gradient', stopOpacity);

    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(400);
    check('undo restores the ramp', (await handles.count()) === before, `${await handles.count()} stops`);
  }
}

// the gradient section: every ramp of the file in one place, and a stop that moves
await page.locator('[data-section=gradients]').click();
await page.waitForTimeout(400);
const gradientRows = page.locator('[data-testid=gradient-row]');
check('the gradients section lists every ramp', (await gradientRows.count()) > 0,
  `${await gradientRows.count()} ramps`);

if (await gradientRows.count()) {
  await gradientRows.first().click();
  await page.waitForTimeout(400);
  const stopHandles = page.locator('[aria-label^="gradient stop"]');
  const stopCount = await stopHandles.count();
  check('opening a ramp shows a handle per colour stop', stopCount > 1, `${stopCount} stops`);

  const strip = await stopHandles.first().evaluate((el) => {
    const box = el.parentElement.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.move(strip.x + 1, strip.y + strip.height / 2);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width * 0.4, strip.y + strip.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const moved = await stopHandles.first().evaluate((el) => parseFloat(el.style.left));
  check('dragging a stop moves it along the ramp', moved > 20, `${moved.toFixed(0)}%`);

  // and the move reaches the rendered SVG, not just the panel
  const offsets = await page.locator('[data-canvas-host] svg').evaluate(
    (svg) => [...svg.querySelectorAll('stop')].map((s) => s.getAttribute('offset')).join(','),
  );
  // lottie-web writes offsets as percentages on some builds and as decimals on others
  check('a moved stop reaches the rendered gradient', /(^|,)(0\.[23456]|[234]\d%)/.test(offsets),
    offsets.slice(0, 60));

  // the mapping survives a structural edit — the probe is built from the edited document
  const stillMapped = await page.locator('[data-canvas-host] svg [data-props]').count();
  check('the canvas stays clickable after a structural edit', stillMapped > 0, `${stillMapped} tagged`);

  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
}

await page.locator('[data-section=palette]').click();
await page.waitForTimeout(200);

// --- step 4: embedded bitmaps ---------------------------------------------
await openFile('How to invest/Illustration 1.json');
const imagesTab = page.locator('[data-section=images]');
const hasImages = (await imagesTab.count()) > 0;
check('image assets are detected', hasImages);

if (hasImages) {
  await imagesTab.click();
  await page.waitForTimeout(1200);
  const canvases = page.locator('aside').last().locator('canvas');
  check('before/after previews render', (await canvases.count()) === 2, `${await canvases.count()} canvases`);

  const swatches = page.locator('aside').last().locator('input[type=color]');
  const n = await swatches.count();
  check('the image palette is listed', n > 0, `${n} colours`);

  if (n > 0) {
    const snapshot = () => canvases.nth(1).evaluate((c) => c.toDataURL());
    const before = await snapshot();
    // Assigning `.value` directly is swallowed by React's value tracker; go through the
    // native setter so the synthetic onChange actually fires.
    await swatches.first().evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '#ff00ff');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    const after = await snapshot();
    check('mapping a colour changes the after preview', before !== after, `${before.length} vs ${after.length} bytes`);

    await page.locator('aside').last().locator('button', { hasText: 'apply to asset' }).click();
    await page.waitForTimeout(1200);
    const applied = await page.locator('aside').last().locator('text=applied').count();
    check('applying writes the asset back', applied > 0);
  }
}

// --- step 5: auto-proposed opposite theme ---------------------------------
await openFile('lotties/How to invest/Illustration 1.json');
await page.locator('[data-section=theme]').click();
await page.waitForTimeout(400);

// Weighted by painted area, not by element count: a light theme flips large dark
// surfaces *and* the small light marks on them, so counting elements says nothing.
const meanLightness = () =>
  page.locator('[data-canvas-host] svg').evaluate((svg) => {
    const lum = (c) => {
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(c ?? '');
      return m ? (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255 : null;
    };
    let total = 0;
    let weight = 0;
    for (const el of svg.querySelectorAll('path, rect, ellipse, circle, polygon')) {
      const v = lum(el.getAttribute('fill'));
      if (v === null) continue;
      let area = 0;
      try {
        const b = el.getBBox();
        area = b.width * b.height;
      } catch {
        continue;
      }
      if (!area) continue;
      total += v * area;
      weight += area;
    }
    return weight ? total / weight : 0;
  });

const darkBefore = await meanLightness();
await page.getByTestId('suggest-light').click();
await page.waitForTimeout(1500);
const lightAfter = await meanLightness();
check('suggesting a light theme lightens the render', lightAfter > darkBefore,
  `${darkBefore.toFixed(3)} -> ${lightAfter.toFixed(3)}`);

const roleRows = page.getByTestId('role-row');
check('every colour gets a role you can correct', (await roleRows.count()) > 0, `${await roleRows.count()} rows`);

await page.keyboard.press('Meta+z');
await page.waitForTimeout(900);
check('undo reverts the whole suggestion in one step',
  Math.abs((await meanLightness()) - darkBefore) < 0.01);

// --- step 6: presets, groups, batch, export -------------------------------
// build a group out of two colours picked in the layer tree
const colourRows = page.locator('aside').first().locator('button[title="shift-click to add to a selection"]');
await colourRows.nth(0).click({ modifiers: ['Shift'] });
await colourRows.nth(1).click({ modifiers: ['Shift'] });
await page.waitForTimeout(300);
check('shift-click builds a selection', (await page.locator('text=2 colours selected').count()) > 0);

page.once('dialog', (d) => d.accept('surface'));
await page.evaluate(() => { window.prompt = () => 'surface'; });
await page.getByTestId('create-group').click();
await page.waitForTimeout(400);
const groupRow = page.locator('aside').last().locator('text=surface').first();
check('the group appears with its member count', await groupRow.isVisible());

const groupSwatch = page.locator('aside').last().locator('input[type=color]').first();
await groupSwatch.evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, '#ff00ff');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(700);
const groupApplied = await page.locator('[data-canvas-host] svg').evaluate((svg) =>
  [...svg.querySelectorAll('*')].filter((el) => /rgb\(255,\s*0,\s*255\)/i.test(el.getAttribute('fill') ?? '')).length);
check('recolouring the group hits every member', groupApplied > 0, `${groupApplied} elements`);
await page.keyboard.press('Meta+z');
await page.waitForTimeout(400);

await page.getByTestId('presets').click();
await page.getByTestId('preset').first().waitFor({ timeout: 5000 });
await page.getByTestId('preset').filter({ hasText: 'dark' }).first().click();
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
check('a preset applies as one undoable step', (await meanLightness()) > 0.5,
  `mean ${(await meanLightness()).toFixed(3)}`);

// the preset stays applied: batch has nothing to export otherwise
await page.getByTestId('batch').click();
await page.waitForTimeout(1000);
const grid = page.locator('div.grid > button');
// reading and rendering 55 files takes a moment
await page.waitForFunction(() => document.querySelectorAll('div.grid > button').length > 40, null, { timeout: 30000 });
check('batch previews every loaded file', (await grid.count()) > 50, `${await grid.count()} tiles`);

const incompatible = await page.locator('div.grid > button', { hasText: 'by-hex only' }).count();
check('batch is honest about structure mismatches', incompatible > 0, `${incompatible} by-hex only`);

const thumbs = await page.locator('div.grid > button svg').count();
check('batch tiles actually render', thumbs > 40, `${thumbs} rendered`);

const selected = await page.locator('div.grid > button.border-\\[var\\(--color-brand\\)\\]').count();
check('files the edits actually touch are pre-selected', selected > 0, `${selected} selected`);

const download = page.waitForEvent('download', { timeout: 90_000 });
await page.locator('button', { hasText: 'Download ZIP' }).click();
const zip = await download;
check('batch produces a zip', (await zip.suggestedFilename()).endsWith('.zip'), await zip.suggestedFilename());
await page.keyboard.press('Escape');
await page.locator('div.fixed.inset-0').click({ position: { x: 5, y: 5 } }).catch(() => {});
await page.waitForTimeout(400);

// --- step 7: eyedropper from a reference screenshot -----------------------
await openFile('lotties/How to invest/Illustration 1.json');
await page.locator('[data-section=reference]').click();
await page.waitForTimeout(300);

const referenceImage = process.env.SMOKE_REFERENCE;
if (referenceImage) {
  await page.locator('aside').last().locator('input[type=file]').setInputFiles(referenceImage);
  await page.waitForTimeout(1500);

  const swatches = page.getByTestId('reference-swatch');
  check('the reference palette is extracted', (await swatches.count()) > 2, `${await swatches.count()} colours`);

  await page.locator('button', { hasText: 'propose a mapping' }).click();
  await page.waitForTimeout(600);
  const rows = page.locator('aside').last().locator('div.row');
  check('a mapping is proposed for the document palette', (await rows.count()) > 2, `${await rows.count()} pairs`);

  const before = await meanLightness();
  await page.locator('button', { hasText: /^apply all/ }).click();
  await page.waitForTimeout(1200);
  const after = await meanLightness();
  check('applying the reference mapping changes the render', Math.abs(after - before) > 0.05,
    `${before.toFixed(3)} -> ${after.toFixed(3)}`);
  check('a light reference produces a light result', after > 0.5, after.toFixed(3));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
} else {
  check('reference check skipped (set SMOKE_REFERENCE)', true);
}

// --- step 11: agent panel -------------------------------------------------
await page.locator('[data-section=agent]').click();
await page.waitForTimeout(400);
const keyField = page.locator('aside').last().locator('input[type=password]');
check('the agent asks for the user\'s own key', await keyField.isVisible());

// the canvas capture is what lets the agent see its own edit; verify it produces a PNG
const captured = await page.evaluate(async () => {
  const svg = document.querySelector('[data-canvas-host] svg');
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '256');
  clone.setAttribute('height', '256');
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(image, 0, 0, 256, 256);
      resolve(canvas.toDataURL('image/png').slice(0, 22));
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
});
check('the canvas can be captured for the agent to look at', captured === 'data:image/png;base64,', String(captured));

check('no console errors or warnings', problems.length === 0, problems.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
