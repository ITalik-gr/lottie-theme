#!/usr/bin/env node
import { DEFAULT_PORT } from './protocol.ts';
import { Hub } from './hub.ts';

/**
 * `lottie-theme-sync` — run this in the folder you are working in, and the editor in the
 * browser and the agent in your terminal are looking at the same thing.
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

if (args.includes('--help') || args.includes('-h')) {
  console.log(`lottie-theme-sync — live bridge between the web editor and a local agent

  --root <dir>    folder to serve and watch (default: current directory)
  --port <n>      default ${DEFAULT_PORT}

Start it, open the editor with the dev server, and point your agent's MCP server at the
same folder. Edits made in either place show up in the other immediately.`);
  process.exit(0);
}

const hub = new Hub({
  root: flag('root') ?? process.cwd(),
  port: Number(flag('port') ?? DEFAULT_PORT),
  onLog: (line) => console.log(line),
});

await hub.listen();

const stop = () => void hub.close().finally(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
