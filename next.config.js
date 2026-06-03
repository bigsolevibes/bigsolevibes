/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.CF_PAGES === '1' ? { output: 'export' } : {}),
  staticPageGenerationTimeout: 120,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
}

module.exports = nextConfig
