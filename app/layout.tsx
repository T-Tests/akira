import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Akira: Family Movie Finder',
  description: 'Find family movies by content boundaries and positive values, on the streaming apps you already have.',
  manifest: '/manifest.webmanifest',
};
export const viewport: Viewport = { themeColor: '#0d9488', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
