/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace package is TS source compiled to dist; transpile it so Next
  // handles it consistently across dev and build.
  transpilePackages: ['@queue-lab/shared'],
  experimental: {
    // Keep these server-only libs out of the bundle; they are required at runtime
    // in the Node.js server. Route handlers run with runtime = "nodejs".
    serverComponentsExternalPackages: ['bullmq', 'ioredis'],
  },
};

export default nextConfig;
