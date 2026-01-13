/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
      return [
        {
          source: '/api/proxy/archive/:path*',
          destination: 'https://ymmuy2.onrender.com/:path*',
        },
      ];
    },
};

export default nextConfig;
