import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const SITE = 'https://lottie.italik.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE}/editor`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/docs`, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
