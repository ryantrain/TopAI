export default {
  // File conversion waits on Gemini, which can take well over the 30-second default.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/:path*` }];
  },
};
