import type { Metadata } from 'next';

// The editor page itself is a client component and so cannot export metadata; this layout
// exists only to carry it.
export const metadata: Metadata = {
  title: 'Editor',
  description:
    'Open a Lottie file, see every colour it contains, and recolour it in the browser. ' +
    'Solid fills, gradients, effects and embedded bitmaps included.',
  alternates: { canonical: '/editor' },
};

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
