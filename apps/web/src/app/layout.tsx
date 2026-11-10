import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { Providers } from '@/components/providers';
import { dirOf } from '@/i18n/config';
import { getLocale, getT } from '@/i18n/server';
import { env } from '@/lib/env';
import './globals.css';

const inter = localFont({
  src: './fonts/InterVariable.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '100 900',
});

const heebo = localFont({
  // Hebrew + Latin subset of Heebo (SIL OFL 1.1), self-hosted so the app never fetches fonts at runtime.
  src: './fonts/HeeboVariable-hebrew.woff2',
  variable: '--font-heebo',
  display: 'swap',
  weight: '100 900',
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    metadataBase: new URL(env.appUrl),
    title: {
      default: t('app.productName'),
      template: `%s · ${t('app.productName')}`,
    },
    description: t('app.metaDescription'),
    applicationName: t('app.productName'),
    icons: { icon: '/favicon.svg' },
    openGraph: {
      title: t('app.productName'),
      description: t('app.metaShortDescription'),
      type: 'website',
      images: ['/logo.svg'],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1116' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${inter.variable} ${heebo.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
