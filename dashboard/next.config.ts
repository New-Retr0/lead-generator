import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["pallares.localhost", "*.pallares.localhost"],
  /** Automatic memoization for client trees (campaign, data, settings, runs). */
  reactCompiler: true,
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
};

export default nextConfig;
