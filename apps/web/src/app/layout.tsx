import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { Providers } from '@/components/providers';
import { env } from '@/lib/env';
import './globals.css';

const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: 'HilaTech AI Assistant',
    template: '%s · HilaTech AI Assistant',
  },
  description:
    'An operational AI assistant for your business: it understands your company, talks to customers, manages leads and automates the work in between.',
  applicationName: 'HilaTech AI Assistant',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'HilaTech AI Assistant',
    description: 'An operational AI assistant for your business.',
    type: 'website',
    images: ['/logo.svg'],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
