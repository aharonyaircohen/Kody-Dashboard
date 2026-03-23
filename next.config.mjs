/** @type {import('next').NextConfig} */
const nextConfig = {
  // Exclude engine files from webpack compilation
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ["**/src/engine/**"],
    };
    return config;
  },
};

export default nextConfig;
