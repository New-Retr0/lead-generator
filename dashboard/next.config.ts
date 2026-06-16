import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["pallares.localhost", "*.pallares.localhost"],
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
