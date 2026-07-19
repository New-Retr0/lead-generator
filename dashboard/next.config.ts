import type { NextConfig } from "next";

/**
 * Portless serves https://pallares.localhost → 127.0.0.1:<ephemeral>.
 * Safari (and opening the backend IP/host directly) is a different Origin than
 * `localhost`; Next 16 blocks /_next HMR + chunks unless those hosts are listed.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "pallares.localhost",
    "*.pallares.localhost",
    "localhost",
    "127.0.0.1",
    "[::1]",
  ],
  /** Automatic memoization for client trees (campaign, data, settings, runs). */
  reactCompiler: true,
  // Safari probes these paths even when <link rel="apple-touch-icon"> is present.
  async redirects() {
    return [
      {
        source: "/apple-touch-icon.png",
        destination: "/apple-icon",
        permanent: false,
      },
      {
        source: "/apple-touch-icon-precomposed.png",
        destination: "/apple-icon",
        permanent: false,
      },
    ];
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "motion",
      "radix-ui",
      "react-icons",
      "@xyflow/react",
      "@number-flow/react",
    ],
  },
  // Safari caches failed Turbopack chunks; force fresh HTML/JS in development.
  // Do NOT no-store /animations — those frames.json payloads are multi‑MB.
  async headers() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/((?!animations/).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/animations/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
