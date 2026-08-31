import { existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Where the local animations are.
 *
 * Everything the editor, the sync hub and the MCP server say to each other about a file is
 * a path *relative to the workspace root* — the browser sends `currentId` to the hub as a
 * path, and the hub resolves it against its own root. So there is only one root, and all
 * three have to agree on it or the bridge silently addresses the wrong file.
 *
 * It used to be the repository itself, with two folder names written into this file. That
 * worked for one person's checkout and nobody else's.
 *
 * - `LOTTIE_WORKSPACE` — the folder paths are relative to. Defaults to the repository root,
 *   which is what `pnpm dev` and `pnpm sync` both run from.
 * - `LOTTIE_DIRS` — comma-separated subfolders of it to browse. Defaults to the two the
 *   repository has. A folder that is not there is skipped rather than being an error: a
 *   fresh clone has neither, and the editor is perfectly usable by dropping files in.
 */

export interface Workspace {
  /** Absolute path. Nothing outside it is readable. */
  root: string;
  /** Absolute paths of the folders to list, each inside `root`. */
  dirs: string[];
  /** How the folders were named in configuration, for the message when none exist. */
  configured: string[];
  /** Whether the configuration came from the environment or is the built-in default. */
  fromEnv: boolean;
}

const DEFAULT_DIRS = ['lotties', 'lotties-light'];

export function workspace(): Workspace {
  const configuredRoot = process.env.LOTTIE_WORKSPACE?.trim();
  // `cwd` is `apps/web` under `pnpm dev`; the repository root is two levels up.
  const root = configuredRoot ? resolve(configuredRoot) : resolve(process.cwd(), '../..');

  const configured = (process.env.LOTTIE_DIRS?.trim() || DEFAULT_DIRS.join(','))
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  const dirs = configured
    // An absolute path in `LOTTIE_DIRS` is a configuration mistake worth ignoring rather
    // than honouring: it would sit outside the root, and every id derived from it would be
    // a `../..` path the sync hub refuses.
    .filter((name) => !isAbsolute(name))
    .map((name) => resolve(root, name))
    .filter((dir) => inside(root, dir) && existsSync(dir));

  return { root, dirs, configured, fromEnv: Boolean(configuredRoot || process.env.LOTTIE_DIRS) };
}

/** True only for a path that really sits inside `root` — the whole of the sandbox. */
export function inside(root: string, full: string): boolean {
  return full === root || full.startsWith(root + sep);
}
