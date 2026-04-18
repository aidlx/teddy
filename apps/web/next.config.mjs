/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@teddy/ai', '@teddy/shared', '@teddy/supabase'],
  serverExternalPackages: ['node-ical'],
};

export default nextConfig;
