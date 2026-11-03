import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Các thư viện đọc file chạy bằng Node thuần, không cần bundle.
  serverExternalPackages: ["xlsx", "mammoth", "pdfjs-dist", "word-extractor"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
