import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    prerenderEarlyExit: true,
  },
};

export default nextConfig;
