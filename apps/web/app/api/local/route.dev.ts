import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { NextResponse } from 'next/server';
import { inside, workspace } from './workspace.ts';

/**
 * Development-only bridge to a folder of animations on disk.
 *
 * The product itself is entirely client-side — a user's files never leave the browser
 * (see ROADMAP §1). This route exists so that converting a folder does not mean re-picking
 * fifty files by hand on every reload. It is disabled outside `next dev`, and refuses any
 * path that escapes the workspace root.
 *
 * Which folder that is comes from `LOTTIE_WORKSPACE` / `LOTTIE_DIRS`; see `workspace.ts`
 * for why there is exactly one root and why the sync hub has to share it.
 */

const enabled = process.env.NODE_ENV === 'development';

async function listJson(dir: string, root: string, acc: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) await listJson(full, root, acc);
    // A `.theme.json` sidecar is an edit set, not an animation. Listing one made the
    // editor open it as a document and crash on a file with no layers.
    else if (name.endsWith('.json') && !name.endsWith('.theme.json')) acc.push(relative(root, full));
  }
}

/**
 * Is the sync hub running?
 *
 * Asked here rather than from the page because a browser logs every refused connection
 * to the console itself, and the editor polls: a developer with no hub running would get
 * a stream of red WebSocket errors for a feature they are not using. The dev server can
 * ask quietly, and the page opens a socket only once there is something to open it to.
 */
async function probeHub(): Promise<Response> {
  const port = process.env.LOTTIE_THEME_SYNC_PORT ?? '4319';
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(400),
    });
    const info = (await response.json()) as { root?: string };
    return NextResponse.json({ running: true, port, root: info.root ?? null });
  } catch {
    return NextResponse.json({ running: false, port });
  }
}

export async function GET(request: Request) {
  if (!enabled) {
    return NextResponse.json({ error: 'local corpus is dev-only' }, { status: 404 });
  }

  const url = new URL(request.url);
  if (url.searchParams.has('sync')) return probeHub();

  const { root, dirs, configured, fromEnv } = workspace();
  const file = url.searchParams.get('file');

  if (file === null) {
    const files: string[] = [];
    for (const dir of dirs) await listJson(dir, root, files);
    files.sort((a, b) => a.localeCompare(b));
    // The folders are reported even when they hold nothing. An empty list on its own is
    // indistinguishable from a folder that is not there, and the editor has to be able to
    // say which — a misconfigured path used to look exactly like an empty corpus.
    return NextResponse.json({
      files,
      workspace: { root, dirs: dirs.map((dir) => relative(root, dir)), configured, fromEnv },
    });
  }

  // Readable means inside one of the browsed folders, not merely inside the workspace. A
  // root set to a home directory would otherwise hand every JSON file on the machine to
  // anything that can reach localhost.
  const full = resolve(root, file);
  if (!dirs.some((dir) => inside(dir, full))) {
    return NextResponse.json({ error: 'path outside the corpus' }, { status: 403 });
  }
  try {
    const body = await readFile(full, 'utf8');
    return new NextResponse(body, { headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
