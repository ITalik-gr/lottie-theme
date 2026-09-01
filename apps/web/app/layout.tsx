import type { Metadata, Viewport } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

const SITE = 'https://lottie.italik.dev';
const DESCRIPTION =
  'Turn a dark-theme Lottie animation into a light one — with visual colour identification, ' +
  'an auto-proposed opposite theme and batch processing. No After Effects, no upload, no account.';

export const metadata: Metadata = {
  // Absolute URLs in the Open Graph tags. Crawlers and chat clients do not resolve a
  // relative one, so without this the preview image silently fails to appear.
  metadataBase: new URL(SITE),
  title: {
    default: 'Lottie Theme — recolour Lottie animations for dark and light',
    template: '%s — Lottie Theme',
  },
  description: DESCRIPTION,
  applicationName: 'Lottie Theme',
  keywords: [
    'lottie', 'lottie editor', 'lottie colors', 'recolor lottie', 'lottie dark mode',
    'lottie light theme', 'bodymovin', 'after effects', 'json animation', 'svg animation',
  ],
  authors: [{ name: 'italik', url: 'https://italik.dev' }],
  creator: 'italik',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE,
    siteName: 'Lottie Theme',
    title: 'Lottie Theme — recolour Lottie animations for dark and light',
    description: DESCRIPTION,
    images: [{ url: '/og.png', width: 1280, height: 640, alt: 'A Lottie card shown dark and light, side by side' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lottie Theme — recolour Lottie animations for dark and light',
    description: DESCRIPTION,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
};

// The page is dark whatever the OS prefers, so the browser chrome around it should be too.
export const viewport: Viewport = { themeColor: '#0a0a0c', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark by design, and said so explicitly: the `dark:` utilities inside the shadcn
    // components must not depend on what the operating system happens to prefer.
    <html lang="en" className="dark">
      <body>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
