/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@teddy/ai', '@teddy/shared', '@teddy/supabase'],
};

export default nextConfig;
