import { LogoMark, Spinner } from '@hilatech/ui';

export function FullPageLoader({ label = 'Loading your workspace' }: { label?: string }) {
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
