/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Ignore node-pty on client side
    config.externals = [...(config.externals || []), 'node-pty'];
    return config;
  },
};

module.exports = nextConfig;
