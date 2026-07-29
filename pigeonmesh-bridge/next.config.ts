import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors fail the build. This was previously ignored, which is how a
  // missing "ack" entry in PRIORITY and DEFAULT_TTL went unnoticed: it made
  // every "responding" / "resolved" / "found" marker fail validation with a
  // NaN expiry, and the compiler had been saying so all along.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
