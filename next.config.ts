import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Helpful in App Router projects; safe defaults
  reactStrictMode: true,
  // typedRoutes is now a top-level option
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["react", "react-dom"],
  },
};

export default nextConfig;
