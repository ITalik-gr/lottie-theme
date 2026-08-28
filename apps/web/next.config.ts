import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source. Only the sync package's wire
  // types are used here, and only as types — nothing of the hub itself is bundled.
  transpilePackages: ['@lottie-theme/core', '@lottie-theme/sync'],
  typedRoutes: true,

  // `route.dev.ts` files exist only while developing. The local-corpus bridge is one:
  // it reads the repository's own `lotties/` folder so that working *on* the tool does
  // not mean re-picking 53 files after every reload. Excluding it from the production
  // build is what lets the app ship as pure static files with no server at all.
  pageExtensions: isDev ? ['ts', 'tsx', 'dev.ts'] : ['ts', 'tsx'],

  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      // The Anthropic SDK reads credential profiles from disk when it runs on a server.
      // In the browser that path is dead code, but webpack still resolves the imports —
      // and it rejects the `node:` scheme before aliases are consulted, so the prefix has
      // to be stripped first and the bare name then resolved to nothing.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        path: false,
        os: false,
        crypto: false,
        child_process: false,
        stream: false,
        buffer: false,
        util: false,
      };
    }
    return config;
  },

  // A static export has nowhere for a user's file to be uploaded to, which is the point.
  ...(process.env.STATIC_EXPORT ? { output: 'export' as const, images: { unoptimized: true } } : {}),
};

export default config;
