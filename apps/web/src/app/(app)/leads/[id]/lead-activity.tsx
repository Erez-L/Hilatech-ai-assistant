'use client';

import * as React from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowRightLeft,
  Coins,
  History,
  Link2,
  Pencil,
  Sparkles,
  StickyNote,
  UserRoundCheck,
} from 'lucide-react';
import type { LeadActivityWithActor } from '@hilatech/contracts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Timeline,
  TimelineItem,
} from '@hilatech/ui';
import { useLeadActivities } from '@/hooks/queries';
import { describeLeadActivity } from '@/lib/crm';
import { QueryState } from '@/components/common/query-state';

const ICONS: Record<LeadActivityWithActor['type'], React.ReactNode> = {
  created: <Sparkles aria-hidden />,
  status_changed: <ArrowRightLeft aria-hidden />,
  assigned: <UserRoundCheck aria-hidden />,
  note_added: <StickyNote aria-hidden />,
  contact_linked: <Link2 aria-hidden />,
  value_changed: <Coins aria-hidden />,
  converted: <Sparkles aria-hidden />,
  updated: <Pencil aria-hidden />,
};

export function LeadActivity({ leadId }: { leadId: string }) {
  const activities = useLeadActivities(leadId, { page: 1, pageSize: 50 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Everything that happened to this lead, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={activities}
          compact
          loading={
            <div className="flex flex-col gap-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex flex-1 flex-col gap-2 pt-1">
                    <Skeleton className="h-3.5 w-56" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          }
          isEmpty={(r) => r.data.length === 0}
          empty={
            <EmptyState
              compact
              icon={<History />}
              title="No activity recorded"
              description="Stage changes, assignments and notes will be listed here."
            />
          }
        >
          {(r) => (
            <Timeline aria-label="Lead activity">
              {r.data.map((activity) => {
                const d = describeLeadActivity(activity);
                return (
                  <TimelineItem
                    key={activity.id}
                    icon={ICONS[activity.type]}
                    tone={d.tone}
                    title={d.title}
                    description={d.description}
                    meta={
                      <time
                        dateTime={activity.createdAt}
                        title={format(new Date(activity.createdAt), 'PPpp')}
                      >
                        {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                      </time>
                    }
                  />
                );
              })}
            </Timeline>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}
