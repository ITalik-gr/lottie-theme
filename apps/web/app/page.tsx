import Link from 'next/link';
import {
  ArrowRight, ArrowUpRight, BookOpen, Boxes, Code2, Eye, Image as ImageIcon,
  MousePointerClick, Package, Sparkles, Terminal, Waves,
} from 'lucide-react';

/**
 * Plain links rather than the shared Button.
 *
 * That component brings cva and tailwind-merge with it, which is 40 kB of class-merging
 * machinery on a page that renders three static links. It earns its place in the editor,
 * where variants are switched at runtime; here it does not.
 */
const LINK = 'inline-flex h-10 items-center gap-2 rounded-lg px-5 text-[14px] font-medium transition-colors [&_svg]:size-4';

const FEATURES = [
  {
    title: 'Click what you mean',
    icon: MousePointerClick,
    body:
      'A click returns the whole stack under the pointer, not one guess. Invisible overlays, ' +
      'gradient masks and hit-boxes are listed with their real opacity, so nothing has to be ' +
      'guessed at and no modifier key is needed to reach the layer underneath.',
  },
  {
    title: 'Gradients that fade into the page',
    icon: Waves,
    body:
      'Alpha ramps live in the same array as the colours and no other tool shows them. ' +
      'A ramp reaching zero is a mask dissolving into the backdrop — invert it and you get a ' +
      'dark halo on a white page. Here you can see it, edit it, and the theme generator knows.',
  },
  {
    title: 'A theme worth starting from',
    icon: Sparkles,
    body:
      'Lightness flips in OKLCH so hues survive: a green comes back a darker green, not ' +
      'magenta. Brand colours are protected rather than inverted, and text is checked ' +
      'against WCAG. It is a draft you correct, and it tells you why it chose what it chose.',
  },
  {
    title: 'Bitmaps too',
    icon: ImageIcon,
    body:
      'Embedded PNGs are dark like everything else. They are recoloured with the same map, ' +
      'blended by distance in OKLab with no threshold anywhere — so antialiased edges stay ' +
      'smooth — and alpha is never touched.',
  },
  {
    title: 'The whole folder at once',
    icon: Boxes,
    body:
      'Name your groups once, then apply the theme to every file with a preview grid. ' +
      'Where a file has a different slot structure it is processed with the parts that ' +
      'travel and says so, instead of being silently mangled or silently skipped.',
  },
  {
    title: 'Same core everywhere',
    icon: Package,
    body:
      'The browser, the CLI and the MCP server are thin shells over one package. A person ' +
      'clicking and a script in CI change a file identically, which is the only way the two ' +
      'can be trusted together.',
  },
];

/** What running it locally adds. Kept separate from FEATURES: these are not things the
 *  page does, they are reasons to leave the page. */
const LOCAL = [
  {
    title: 'It looks at its own work',
    icon: Eye,
    body:
      'The agent renders what it changed, on the background the animation will sit on, and ' +
      'looks. A gradient fading into the backdrop is correct in the JSON and a dark halo on ' +
      'the page — nothing but looking catches that.',
  },
  {
    title: 'It reaches colours no palette shows',
    icon: ImageIcon,
    body:
      'A striped PNG baked into the file, the colour carried by a Drop Shadow effect. Both are ' +
      'invisible on the theme they were drawn for and obvious on the other one, and neither ' +
      'appears in any palette — including this one.',
  },
  {
    title: 'It samples instead of guessing',
    icon: MousePointerClick,
    body:
      'Give it the screenshot of the page the animation has to match. It reads the exact ' +
      'colours out of the pixels and checks its plan against them before writing anything, ' +
      'rather than typing a hex that is a shade or two off.',
  },
  {
    title: 'It does the whole folder',
    icon: Boxes,
    body:
      'One edit set across every file, each one previewed, with the mismatches named instead ' +
      'of silently skipped. The same core the editor uses, so a file it converts and a file ' +
      'you convert come out identical.',
  },
];

/**
 * Structured data for the search result, not for the page.
 *
 * Without it Google has only the <title> to go on and renders the entry as a bare link;
 * with it the tool is described as software that costs nothing and runs in a browser,
 * which is the whole of what a searcher wants to know before clicking.
 */
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Lottie Theme',
  url: 'https://lottie.italik.dev',
  applicationCategory: 'DesignApplication',
  operatingSystem: 'Any, in a web browser',
  description:
    'Recolour a Lottie animation between dark and light themes: find every colour it ' +
    'contains, propose the opposite theme, and write the result back.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Person', name: 'italik', url: 'https://italik.dev' },
};

export default function Home() {
  return (
    <main className="mx-auto max-w-[900px] px-6 py-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <div className="mx-auto max-w-[640px] text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] px-3 py-1 text-[11px] tracking-wide text-[var(--color-fg-mute)] uppercase">
          <span className="size-1.5 rounded-full bg-[var(--color-ok)]" />
          runs entirely in your browser
        </span>
        <h1 className="mt-5 text-[38px] leading-tight font-semibold tracking-tight">Lottie Theme</h1>
        <p className="mt-4 text-[16px] leading-relaxed text-[var(--color-fg-dim)]">
          Turn a dark-theme Lottie animation into a light one — with visual colour
          identification, an auto-proposed opposite theme and batch processing. No After Effects.
        </p>
        <p className="mt-3 text-[14px] text-[var(--color-fg-mute)]">
          Your files are never uploaded, and there is no account to make.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          <Link
            href="/editor"
            className={`${LINK} bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-bright)]`}
          >
            Open the editor
            <ArrowRight />
          </Link>
          <Link
            href="/docs"
            className={`${LINK} border border-[var(--color-line)] hover:bg-[var(--color-hover)]`}
          >
            <BookOpen />
            How Lottie stores colour
          </Link>
          <a
            href="https://github.com/ITalik-gr/lottie-theme"
            rel="noreferrer"
            className={`${LINK} text-[var(--color-fg-dim)] hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]`}
          >
            <Code2 />
            Source
          </a>
        </div>
      </div>

      <div className="mt-16 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <section
            key={feature.title}
            className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5 transition-colors hover:border-[var(--color-ink-4)]"
          >
            <feature.icon className="mb-3 size-4 text-[var(--color-brand-bright)]" />
            <h2 className="text-[14px] font-medium">{feature.title}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-fg-dim)]">{feature.body}</p>
          </section>
        ))}
      </div>

      {/* The page is the whole product for one file. It is not the whole tool, and saying
          so plainly is more useful than pretending the browser can do everything. */}
      <section className="mt-16 rounded-xl border border-[var(--color-brand)]/30 bg-[var(--color-brand)]/[0.06] p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1 text-[11px] tracking-wide text-[var(--color-fg-mute)] uppercase">
          <Terminal className="size-3" />
          the best results are local
        </span>
        <h2 className="mt-4 text-[20px] font-semibold tracking-tight">
          Clone it, open it with an AI agent, and hand it the whole folder
        </h2>
        <p className="mt-3 max-w-[680px] text-[14px] leading-relaxed text-[var(--color-fg-dim)]">
          Everything here works in the browser, on one file at a time, with you deciding each
          colour. Run the project locally instead and an agent works through the same core over
          an MCP server — with two things this page cannot give it: it can <em>look</em> at what
          it rendered, and it can reach the colours no palette lists.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {LOCAL.map((item) => (
            <div key={item.title} className="flex gap-3">
              <item.icon className="mt-0.5 size-4 shrink-0 text-[var(--color-brand-bright)]" />
              <div>
                <h3 className="text-[13px] font-medium">{item.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-fg-dim)]">{item.body}</p>
              </div>
            </div>
          ))}
        </div>

        <pre className="mt-5 overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-background)] p-3 font-mono text-[12px] leading-relaxed text-[var(--color-fg-dim)]">
{`git clone https://github.com/ITalik-gr/lottie-theme
pnpm install && pnpm dev          # the editor
claude                            # the agent, already wired to this folder`}
        </pre>
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-fg-mute)]">
          Then: <span className="text-[var(--color-fg-dim)]">&ldquo;make light versions of everything
          in <code>lotties/</code>, match them to this screenshot, and show me the ones you were
          unsure about&rdquo;</span>. Run <code>npx lottie-theme-sync</code> as well and the agent and
          the editor share one session — its changes appear in your undo stack, one keystroke from
          being rejected.
        </p>
      </section>

      <footer className="mt-16 flex flex-col items-center gap-4 border-t border-[var(--color-line)] pt-5 text-center text-[12px] text-[var(--color-fg-mute)]">
        <p>
          MIT. Also available as <code className="text-[var(--color-fg-dim)]">npx lottie-theme</code> for CI,
          and as an MCP server so an AI agent can edit through the same core.
        </p>
        <a
          href="https://www.italik.dev/?ref=lottie-editor"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] text-[var(--color-fg-dim)] transition-colors hover:bg-[var(--color-hover)] hover:text-[var(--color-fg)]"
        >
          Developer — italik.dev
          <ArrowUpRight className="size-3.5" />
        </a>
      </footer>
    </main>
  );
}
