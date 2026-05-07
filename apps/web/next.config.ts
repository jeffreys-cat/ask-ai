import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@selectdb/ai", "@selectdb/auth", "@selectdb/db", "@selectdb/doris", "@selectdb/jobs", "@selectdb/rag", "@selectdb/shared"],
};

export default nextConfig;
