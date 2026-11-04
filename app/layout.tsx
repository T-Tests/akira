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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved/system theme before paint to avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('akira:theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
