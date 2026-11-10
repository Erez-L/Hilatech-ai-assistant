'use client';

import { LogoMark, Spinner } from '@hilatech/ui';
import { useT } from '@/i18n/provider';

export function FullPageLoader({ label }: { label?: string }) {
  const t = useT();
  label ??= t('common.loadingYourWorkspace');
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg"
      role="status"
      aria-live="polite"
    >
      <LogoMark size={36} />
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Spinner size="sm" label={label} />
        <span>{label}</span>
      </div>
    </div>
  );
}
