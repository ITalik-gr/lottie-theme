import type { Metadata } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lottie Theme Studio',
  description: 'Turn a dark-theme Lottie into a light one, without After Effects.',
};

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
