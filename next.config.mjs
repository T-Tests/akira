/** @type {import('next').NextConfig} */
// Static export => Cloudflare Pages serves plain files: no Worker CPU limits, free & unlimited bandwidth.
export default {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};
