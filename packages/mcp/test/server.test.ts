import { describe, it, expect, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Drives the real server over stdio, the way an agent would. */
const repoRoot = resolve(import.meta.dirname, '../../..');

/** These read real animations from `lotties/`, which is a client's corpus and not
 *  necessarily checked out beside the code. Missing corpus is a skip, not a failure. */
const hasCorpus = existsSync(resolve(repoRoot, 'lotties'));
const client = new Client({ name: 'test', version: '0' });

await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', resolve(import.meta.dirname, '../src/server.ts')],
    cwd: repoRoot,
    stderr: 'ignore',
  }),
);

afterAll(() => client.close());

const parse = (result: unknown) =>
  JSON.parse(((result as { content: { type: string; text: string }[] }).content[0]!).text);

describe.skipIf(!hasCorpus)('the server over stdio', () => {
  it('advertises the tools an agent needs to work without guessing', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'apply_edits',
      'layer_tree',
      'list_effects',
      'list_gradients',
      'list_slots',
      'push_edits',
      'read_palette',
      'recolor_image',
      'render_preview',
      'sample_screenshot',
      'session_state',
      'suggest_theme',
    ]);
  });

  it('answers session_state with connected: false when no bridge is running', async () => {
    // The server is started without a hub: an agent must be able to work alone, and a
    // missing browser is a fact to report, not an error to fail on.
    const result = parse(await client.callTool({ name: 'session_state', arguments: {} }));
    expect(result.connected).toBe(false);
    expect(result.hint).toContain('lottie-theme-sync');
  });

  it('describes every tool, since the description is all a model has to go on', async () => {
    for (const tool of (await client.listTools()).tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    }
  });

  it('reads a palette', async () => {
    const result = parse(
      await client.callTool({ name: 'read_palette', arguments: { path: 'lotties/Low Fidelity_anim(dark).json' } }),
    );
    expect(result.slots).toBe(5);
    expect(result.colors[0].hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('suggests a theme without touching the file', async () => {
    const result = parse(
      await client.callTool({
        name: 'suggest_theme',
        arguments: { path: 'lotties/Low Fidelity_anim(dark).json', target: 'light', explain: true },
      }),
    );
    expect(Object.keys(result.edits.byIndex).length).toBeGreaterThan(0);
    expect(result.explained[0].reason).toBeTruthy();
  });

  it('returns an image from render_preview, so the agent can see its own edit', async () => {
    const result = (await client.callTool({
      name: 'render_preview',
      arguments: { path: 'lotties/Low Fidelity_anim(dark).json', width: 128, height: 128, background: '#FFFFFF' },
    })) as { content: { type: string; data?: string; mimeType?: string }[] };
    const image = result.content.find((c) => c.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image!.data!, 'base64').readUInt32BE(0)).toBe(0x89504e47);
  }, 60_000);

  it('refuses a path outside the workspace', async () => {
    const result = (await client.callTool({
      name: 'read_palette',
      arguments: { path: '../../../etc/passwd' },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/outside the workspace/);
  });
});
