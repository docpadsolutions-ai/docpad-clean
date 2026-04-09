import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Load from node_modules at runtime — avoids Turbopack “Can’t resolve 'resend'” in some setups */
  serverExternalPackages: ["resend"],
  transpilePackages: ["@react-pdf/renderer"],
};

export default nextConfig;
