import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  ...(process.env.TODAYTABLE_IN_PROCESS_TYPESCRIPT === '1'
    ? { experimental: { useTypeScriptCli: false } }
    : {}),
  output: 'standalone',
  turbopack: {
    root: '.',
  },
}

export default nextConfig