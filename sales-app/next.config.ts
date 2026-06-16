import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "motion",
      "radix-ui",
      "react-icons",
    ],
  },
};

export default nextConfig;
