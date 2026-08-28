#!/usr/bin/env node
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { collectSlots, type ThemeEdits } from '@lottie-theme/core';
import { apply, list, mergeEdits, parseAssignments, report, suggest } from './commands.ts';

const USAGE = `lottie-theme — recolour Lottie animations

  report <file...>                    colours in each file, most used first
  list <file>                         every colour slot in z-order, with its index
  apply <in> <out> [OLD=NEW | N=NEW]  recolour by hex, or a single slot by index
  suggest <in> <out> [--dark]         generate the opposite theme
  batch <dir> <out-dir>               apply a theme to a whole folder

Options
  --theme <file>     read an edit set (a .theme.json) and apply it too
  --embed            write the edit set into the output as meta.themeStudio
  --use-embedded     start from the edit set already inside the input
  --save-theme <f>   write the resulting edit set beside the output
  --backdrop <hex>   the colour the animation will sit on (default #FFFFFF)
  --pretty           indent the output instead of minifying
  --reference <f>    only apply position-addressed edits where the structure matches
`;

const args = process.argv.slice(2);

function flag(name: string): boolean {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
}

function option(name: string): string | null {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return null;
  const value = args[at + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  args.splice(at, 2);
  return value;
}

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

async function writeJson(path: string, value: unknown, pretty: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
}

async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) out.push(...(await jsonFiles(full)));
    else if (entry.endsWith('.json') && !entry.endsWith('.theme.json')) out.push(full);
  }
  return out.sort();
}

async function main(): Promise<number> {
  const pretty = flag('pretty');
  const embed = flag('embed');
  const useEmbedded = flag('use-embedded');
  const dark = flag('dark');
  const themePath = option('theme');
  const savePath = option('save-theme');
  const backdrop = option('backdrop') ?? undefined;
  const referencePath = option('reference');

  const command = args.shift();
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }

  const fromTheme: ThemeEdits | null = themePath ? await readJson(themePath) : null;
  const reference = referencePath ? collectSlots(await readJson(referencePath)) : undefined;

  if (command === 'report') {
    if (!args.length) throw new Error('report needs at least one file');
    for (const file of args) {
      const r = report(await readJson(file));
      process.stdout.write(`${file}  ${r.slots} slots, ${r.properties} editable, ${r.colors.length} colours\n`);
      for (const c of r.colors) {
        process.stdout.write(`  ${c.hex}  ×${String(c.count).padEnd(4)} ${c.kinds.join(', ')}\n`);
      }
    }
    return 0;
  }

  if (command === 'list') {
    const file = args[0];
    if (!file) throw new Error('list needs a file');
    for (const row of list(await readJson(file))) {
      process.stdout.write(`${String(row.index).padStart(4)}  ${row.hex}  ${row.description}\n`);
    }
    return 0;
  }

  if (command === 'apply') {
    const [input, output, ...assignments] = args;
    if (!input || !output) throw new Error('apply needs an input and an output');
    const edits = mergeEdits([fromTheme, parseAssignments(assignments)].filter(Boolean) as ThemeEdits[]);
    const result = apply(await readJson(input), edits, { embed, useEmbedded, reference });
    await writeJson(output, result.doc, pretty);
    if (savePath) await writeJson(savePath, result.edits, true);
    process.stdout.write(`${result.colorsChanged}/${result.totalSlots} slots changed → ${output}\n`);
    for (const warning of result.warnings) process.stderr.write(`  warning: ${warning}\n`);
    return 0;
  }

  if (command === 'suggest') {
    const [input, output] = args;
    if (!input || !output) throw new Error('suggest needs an input and an output');
    const doc = await readJson(input);
    const suggestion = suggest(doc, dark ? 'dark' : 'light', backdrop);
    const edits = mergeEdits([suggestion.edits, fromTheme].filter(Boolean) as ThemeEdits[]);
    const result = apply(doc, edits, { embed, useEmbedded });
    await writeJson(output, result.doc, pretty);
    if (savePath) await writeJson(savePath, result.edits, true);
    process.stdout.write(`${result.colorsChanged}/${result.totalSlots} slots changed → ${output}\n`);
    for (const issue of suggestion.audit) {
      process.stderr.write(
        `  warning: ${issue.hex} on ${issue.against} is ${issue.ratio.toFixed(1)}:1, wanted ${issue.required}:1\n`,
      );
    }
    return 0;
  }

  if (command === 'batch') {
    const [inputDir, outputDir] = args;
    if (!inputDir || !outputDir) throw new Error('batch needs an input and an output directory');
    if (!fromTheme) throw new Error('batch needs --theme');
    const files = await jsonFiles(resolve(inputDir));
    let changed = 0;
    for (const file of files) {
      const doc = await readJson(file);
      const result = apply(doc, fromTheme, { embed, useEmbedded, reference });
      const out = join(outputDir, relative(resolve(inputDir), file));
      await writeJson(out, result.doc, pretty);
      changed += result.colorsChanged;
      const notes = result.warnings.length ? `  (${result.warnings[0]})` : '';
      process.stdout.write(`${result.colorsChanged.toString().padStart(4)}  ${out}${notes}\n`);
    }
    process.stdout.write(`${files.length} files, ${changed} slots changed\n`);
    return 0;
  }

  process.stderr.write(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
