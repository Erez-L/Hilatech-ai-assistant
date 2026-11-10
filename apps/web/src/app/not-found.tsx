import Link from 'next/link';
import { Button, Wordmark } from '@hilatech/ui';
import { getT } from '@/i18n/server';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <Wordmark />
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-fg-muted">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('app.thisPageDoesnTExist')}</h1>
        <p className="max-w-sm text-sm text-fg-muted">{t('app.theLinkMayBeOut')}</p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/dashboard">{t('common.goToDashboard')}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">{t('app.home')}</Link>
        </Button>
      </div>
    </div>
  );
}
