import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the project root to this folder. A stray package-lock.json in the
    // home folder otherwise makes Next.js print a root warning on every run.
    root: __dirname,
  },
};

export default nextConfig;
