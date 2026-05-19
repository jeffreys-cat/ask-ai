import type { NextConfig } from "next";

const cwd = process.cwd();
const workspaceRoot = process.env.NEXT_WORKSPACE_ROOT ?? cwd.replace(/\/apps\/web$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  transpilePackages: ["@selectdb/ai", "@selectdb/auth", "@selectdb/db", "@selectdb/doris", "@selectdb/jobs", "@selectdb/rag", "@selectdb/shared"],
};

export default nextConfig;
