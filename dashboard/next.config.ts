import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["pallares.localhost", "*.pallares.localhost"],
};

export default nextConfig;
