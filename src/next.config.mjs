/** @type {import('next').NextConfig} */
const nextConfig = {};

// Set only by `npm run test:integration`, in the environment of the `next build` it starts
// (src/__tests__/integration/next-app.ts): its offline test build stays out of Turbopack's persistent build cache,
// which belongs to the ordinary build, so neither build reuses the other's font requests. Unset, nothing changes.
if (process.env.INTEGRATION_OFFLINE_BUILD === '1') {
  nextConfig.experimental = { turbopackFileSystemCacheForBuild: false };
}

export default nextConfig;
