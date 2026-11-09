import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Construction } from 'lucide-react';
import Link from 'next/link';
import { Button, EmptyState, PageHeader } from '@hilatech/ui';

export interface UpcomingFeatureProps {
  title: string;
  description: string;
  /** What this area will do once it lands — rendered as plain sentences, never as mock data. */
  capabilities: string[];
  icon: LucideIcon;
  milestone: string;
}

/** Consistent placeholder for areas scheduled for a later milestone. Shows no fabricated data. */
export function UpcomingFeature({
  title,
  description,
  capabilities,
  icon: Icon,
  milestone,
}: UpcomingFeatureProps) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={<Construction />}
        title="Available in an upcoming milestone"
        description={`${title} is scheduled for the ${milestone} milestone. Nothing here is live yet.`}
        action={
          <Button asChild variant="secondary" trailingIcon={<ArrowRight aria-hidden />}>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
      <section aria-labelledby="planned" className="rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Icon className="size-4 text-fg-muted" aria-hidden />
          <h2 id="planned" className="text-sm font-semibold">
            What this area will do
          </h2>
        </div>
        <ul className="divide-y divide-border">
          {capabilities.map((c) => (
            <li key={c} className="px-5 py-3 text-sm text-fg-muted">
              {c}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
