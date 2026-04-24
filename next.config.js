/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
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
