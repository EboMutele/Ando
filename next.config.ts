import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native / file-reading packages stay outside the server bundle.
  serverExternalPackages: ['better-sqlite3', 'sharp', 'pdfkit', '@meta-sam/parser'],
};

export default nextConfig;
