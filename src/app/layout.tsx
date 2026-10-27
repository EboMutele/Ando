import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ando — early pain signals for cats and dogs',
  description: 'Short phone videos, scored against veterinary pain scales, so you notice sooner.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand" aria-hidden fill="currentColor">
                <circle cx="6" cy="9" r="2.2" />
                <circle cx="10" cy="5.5" r="2.2" />
                <circle cx="14" cy="5.5" r="2.2" />
                <circle cx="18" cy="9" r="2.2" />
                <path d="M12 10.5c-3.2 0-6 3.6-6 6.3 0 1.8 1.4 2.7 3 2.7 1.2 0 2-.6 3-.6s1.8.6 3 .6c1.6 0 3-.9 3-2.7 0-2.7-2.8-6.3-6-6.3z" />
              </svg>
              Ando
            </Link>
            <span className="text-xs text-ink-3">Pain-signal checks</span>
          </div>
        </header>
        <main className="mx-auto max-w-xl px-4 pb-16 pt-4">{children}</main>
      </body>
    </html>
  );
}
