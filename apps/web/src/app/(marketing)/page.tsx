import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CalendarCheck,
  LineChart,
  Lock,
  MessageSquare,
  ScrollText,
  Target,
  Users,
  Workflow,
} from 'lucide-react';
import { Button, LogoMark, Wordmark } from '@hilatech/ui';
import { ThemeToggle } from '@/components/shell/theme-toggle';

export const metadata: Metadata = {
  title: { absolute: 'HilaTech AI Assistant — an operational assistant for your business' },
  description:
    'Answers customers, qualifies leads, runs routines and reports back — in one secure workspace your whole team shares.',
};

const CAPABILITIES = [
  {
    icon: MessageSquare,
    title: 'Talks to your customers',
    body: 'Handles conversations across channels in your tone, with your knowledge, and hands over to a person when it should.',
  },
  {
    icon: Target,
    title: 'Manages leads and contacts',
    body: 'Captures every enquiry, qualifies it, assigns it, and keeps the pipeline honest with notes and activity history.',
  },
  {
    icon: Bot,
    title: 'Agents that execute',
    body: 'Agents call tools, delegate to each other and stop at hard limits — steps, time, tokens — with a permission check before every action.',
  },
  {
    icon: BookOpen,
    title: 'Knows your business',
    body: 'Documents, policies and FAQs become a searchable knowledge base that grounds every answer in your own material.',
  },
  {
    icon: Workflow,
    title: 'Automates the routine',
    body: 'Workflows, webhooks and n8n integrations run follow-ups, reminders and hand-offs without anyone remembering to.',
  },
  {
    icon: LineChart,
    title: 'Reports back',
    body: 'A dashboard for the team, usage against plan limits, and an audit log of who did what — including the assistant.',
  },
] as const;

const TRUST = [
  {
    icon: Users,
    title: 'Built for teams',
    body: 'Organizations, invitations, roles with granular permissions. People can belong to several organizations.',
  },
  {
    icon: Lock,
    title: 'Isolated by design',
    body: 'Every record is scoped to the organization. Tokens are short-lived; sessions can be reviewed and revoked.',
  },
  {
    icon: ScrollText,
    title: 'Accountable',
    body: 'Every sensitive action is written to an audit trail with actor, target and request id.',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Wordmark />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button asChild variant="ghost">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Create workspace</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-24">
          <div className="flex flex-col gap-7">
            <h1 className="max-w-[14ch] text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-5xl lg:text-[3.5rem]">
              One assistant that knows your business and does the work.
            </h1>
            <p className="max-w-[52ch] text-lg leading-relaxed text-fg-muted">
              HilaTech AI Assistant answers customers, qualifies leads, runs your routines and reports
              back — inside one secure workspace your whole team shares.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" trailingIcon={<ArrowRight aria-hidden />}>
                <Link href="/register">Create your workspace</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
            <p className="text-sm text-fg-subtle">
              Free plan includes two seats. No payment details needed to start.
            </p>
          </div>

          <ConversationLedger />
        </section>

        {/* Capabilities */}
        <section aria-labelledby="capabilities" className="border-t border-border bg-surface">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <div className="mb-10 flex max-w-2xl flex-col gap-3">
              <h2 id="capabilities" className="text-3xl font-semibold tracking-tight">
                Everything the front line needs, in one place
              </h2>
              <p className="text-fg-muted">
                Modules share one data model, one permission system and one audit trail — so the
                assistant can act across all of them.
              </p>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <li key={c.title} className="flex flex-col gap-3 bg-surface p-6">
                    <Icon className="size-5 text-accent" aria-hidden />
                    <h3 className="text-base font-semibold">{c.title}</h3>
                    <p className="text-sm leading-relaxed text-fg-muted">{c.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section aria-labelledby="trust" className="border-t border-border">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="flex flex-col gap-3">
              <h2 id="trust" className="text-3xl font-semibold tracking-tight">
                Multi-tenant from the first line of code
              </h2>
              <p className="text-fg-muted">
                The platform is built as a commercial SaaS foundation: tenancy, roles, billing
                readiness and auditability are part of the core, not add-ons.
              </p>
            </div>
            <dl className="grid gap-6 sm:grid-cols-3">
              {TRUST.map((t) => {
                const Icon = t.icon;
                return (
                  <div key={t.title} className="flex flex-col gap-2">
                    <dt className="flex items-center gap-2 font-semibold">
                      <Icon className="size-4 text-accent" aria-hidden />
                      {t.title}
                    </dt>
                    <dd className="text-sm leading-relaxed text-fg-muted">{t.body}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-border bg-surface">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold tracking-tight">Set up your workspace in a minute</h2>
              <p className="text-fg-muted">Create an organization, invite your team, connect your assistant.</p>
            </div>
            <Button asChild size="lg" trailingIcon={<ArrowRight aria-hidden />}>
              <Link href="/register">Create your workspace</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={24} />
            <span className="text-sm text-fg-muted">© {new Date().getFullYear()} HilaTech Dev. All rights reserved.</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted">
            <Link href="/login" className="hover:text-fg">
              Sign in
            </Link>
            <Link href="/register" className="hover:text-fg">
              Create account
            </Link>
            <Link href="/forgot-password" className="hover:text-fg">
              Reset password
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * Illustration of the assistant handling one enquiry end to end. Marked as an example;
 * nothing here is live data.
 */
function ConversationLedger() {
  return (
    <figure
      aria-label="Example: the assistant handling a customer enquiry"
      className="relative rounded-xl border border-border bg-surface p-5 shadow-sm lg:p-6"
    >
      <figcaption className="mb-4 flex items-center justify-between text-xs text-fg-subtle">
        <span>Example conversation</span>
        <span className="rounded-full border border-border px-2 py-0.5">WhatsApp · 09:42</span>
      </figcaption>
      <ol className="flex flex-col gap-3 text-sm">
        <li className="max-w-[85%] self-start rounded-lg rounded-tl-xs bg-surface-muted px-3.5 py-2.5 text-fg">
          Hi, do you have a slot for a teeth cleaning this week? Preferably after 17:00.
        </li>
        <li className="max-w-[85%] self-end rounded-lg rounded-tr-xs bg-accent px-3.5 py-2.5 text-accent-fg">
          Yes — Thursday at 17:30 with Dr. Levi is open. Shall I book it under your number?
        </li>
        <li className="max-w-[85%] self-start rounded-lg rounded-tl-xs bg-surface-muted px-3.5 py-2.5 text-fg">
          Yes please, it&apos;s for me, Noa.
        </li>
      </ol>
      <div className="mt-5 border-t border-dashed border-border pt-4">
        <p className="mb-2 text-xs text-fg-subtle">What the assistant did</p>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-success" aria-hidden />
            Booked Thursday 17:30 · Dr. Levi
          </li>
          <li className="flex items-center gap-2">
            <Target className="size-4 text-success" aria-hidden />
            Created lead “Noa — cleaning” · source WhatsApp
          </li>
          <li className="flex items-center gap-2">
            <Users className="size-4 text-success" aria-hidden />
            Notified the front desk
          </li>
        </ul>
      </div>
    </figure>
  );
}
