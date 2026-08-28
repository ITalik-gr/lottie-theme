import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { NextResponse } from 'next/server';

/**
 * Development-only bridge to the repository's own `lotties/` folder.
 *
 * The product itself is entirely client-side — a user's files never leave the browser
 * (see ROADMAP §1). This route exists so that working *on* the tool against the local
 * corpus does not mean re-picking 53 files by hand on every reload. It is disabled
 * outside `next dev`, and refuses any path that escapes the allowed roots.
 */

const repoRoot = resolve(process.cwd(), '../..');
const ROOTS = ['lotties', 'lotties-light'];

const enabled = process.env.NODE_ENV === 'development';

async function listJson(dir: string, acc: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) await listJson(full, acc);
    // A `.theme.json` sidecar is an edit set, not an animation. Listing one made the
    // editor open it as a document and crash on a file with no layers.
    else if (name.endsWith('.json') && !name.endsWith('.theme.json')) acc.push(relative(repoRoot, full));
  }
}

/** True only for a path that really sits inside one of the allowed roots. */
function isAllowed(rel: string): boolean {
  const full = resolve(repoRoot, rel);
  return ROOTS.some((root) => {
    const base = resolve(repoRoot, root);
    return full === base || full.startsWith(base + sep);
  });
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

  const file = new URL(request.url).searchParams.get('file');
  if (file === null) {
    const files: string[] = [];
    for (const root of ROOTS) await listJson(resolve(repoRoot, root), files);
    files.sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ files });
  }

  if (!isAllowed(file)) {
    return NextResponse.json({ error: 'path outside the corpus' }, { status: 403 });
  }
  try {
    const body = await readFile(resolve(repoRoot, file), 'utf8');
    return new NextResponse(body, { headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
