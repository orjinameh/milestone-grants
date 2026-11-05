/** @type {import('next').NextConfig} */
// swcMinify is off: Next's SWC minifier emits invalid octal escapes in a template string from a @polkadot
// dependency, which crashes the wallet chunk at runtime ("Loading chunk ... failed") in production builds.
const nextConfig = { reactStrictMode: true, swcMinify: false };
export default nextConfig;
