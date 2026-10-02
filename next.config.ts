import type { NextConfig } from "next";

/**
 * Basic hardening for every response: no framing by other sites, no MIME sniffing,
 * a short referrer, and no camera/microphone/location access (the photo upload uses a
 * plain file picker). A full Content-Security-Policy is left out: Next.js inlines
 * scripts, and a wrong policy would break the page.
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  turbopack: {
    // Pin the project root to this folder. A stray package-lock.json in the
    // home folder otherwise makes Next.js print a root warning on every run.
    root: __dirname,
  },
};

export default nextConfig;
