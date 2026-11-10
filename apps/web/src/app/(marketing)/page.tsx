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
import { getT } from '@/i18n/server';
import type { MessageKey } from '@/i18n/messages';
import { LanguageSwitcher } from '@/components/shell/language-switcher';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t('marketing.metaTitle') },
    description: t('marketing.metaDescription'),
  };
}

const CAPABILITIES = [
  {
    icon: MessageSquare,
    titleKey: 'marketing.capabilities.talksToYour.title',
    bodyKey: 'marketing.capabilities.talksToYour.body',
  },
  {
    icon: Target,
    titleKey: 'marketing.capabilities.managesLeadsAnd.title',
    bodyKey: 'marketing.capabilities.managesLeadsAnd.body',
  },
  {
    icon: Bot,
    titleKey: 'marketing.capabilities.agentsThatExecute.title',
    bodyKey: 'marketing.capabilities.agentsThatExecute.body',
  },
  {
    icon: BookOpen,
    titleKey: 'marketing.capabilities.knowsYourBusiness.title',
    bodyKey: 'marketing.capabilities.knowsYourBusiness.body',
  },
  {
    icon: Workflow,
    titleKey: 'marketing.capabilities.automatesTheRoutine.title',
    bodyKey: 'marketing.capabilities.automatesTheRoutine.body',
  },
  {
    icon: LineChart,
    titleKey: 'marketing.capabilities.reportsBack.title',
    bodyKey: 'marketing.capabilities.reportsBack.body',
  },
] as const satisfies readonly { icon: unknown; titleKey: MessageKey; bodyKey: MessageKey }[];

const TRUST = [
  {
    icon: Users,
    titleKey: 'marketing.trust.builtForTeams.title',
    bodyKey: 'marketing.trust.builtForTeams.body',
  },
  {
    icon: Lock,
    titleKey: 'marketing.trust.isolatedByDesign.title',
    bodyKey: 'marketing.trust.isolatedByDesign.body',
  },
  {
    icon: ScrollText,
    titleKey: 'marketing.trust.accountable.title',
    bodyKey: 'marketing.trust.accountable.body',
  },
] as const satisfies readonly { icon: unknown; titleKey: MessageKey; bodyKey: MessageKey }[];

export default async function LandingPage() {
  const { t } = await getT();
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Wordmark />
          </Link>
          <nav aria-label={t('marketing.account')} className="flex items-center gap-1.5">
            <LanguageSwitcher />
            <ThemeToggle />
            <Button asChild variant="ghost">
              <Link href="/login">{t('common.signIn')}</Link>
            </Button>
            <Button asChild>
              <Link href="/register">{t('marketing.createWorkspace')}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-24">
          <div className="flex flex-col gap-7">
            <h1 className="max-w-[14ch] text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.025em] sm:text-5xl lg:text-[3.5rem]">
              {t('marketing.oneAssistantThatKnowsYour')}
            </h1>
            <p className="max-w-[52ch] text-lg leading-relaxed text-fg-muted">
              {t('marketing.hilatechAiAssistantAnswersCustomers')}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" trailingIcon={<ArrowRight aria-hidden />}>
                <Link href="/register">{t('marketing.createYourWorkspace')}</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/login">{t('common.signIn')}</Link>
              </Button>
            </div>
            <p className="text-sm text-fg-subtle">{t('marketing.freePlanIncludesTwoSeats')}</p>
          </div>

          <ConversationLedger />
        </section>

        {/* Capabilities */}
        <section aria-labelledby="capabilities" className="border-t border-border bg-surface">
          <div className="mx-auto w-full max-w-6xl px-6 py-20">
            <div className="mb-10 flex max-w-2xl flex-col gap-3">
              <h2 id="capabilities" className="text-3xl font-semibold tracking-tight">
                {t('marketing.everythingTheFrontLineNeeds')}
              </h2>
              <p className="text-fg-muted">{t('marketing.modulesShareOneDataModel')}</p>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <li key={c.titleKey} className="flex flex-col gap-3 bg-surface p-6">
                    <Icon className="size-5 text-accent" aria-hidden />
                    <h3 className="text-base font-semibold">{t(c.titleKey)}</h3>
                    <p className="text-sm leading-relaxed text-fg-muted">{t(c.bodyKey)}</p>
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
                {t('marketing.multiTenantFromTheFirst')}
              </h2>
              <p className="text-fg-muted">{t('marketing.thePlatformIsBuiltAs')}</p>
            </div>
            <dl className="grid gap-6 sm:grid-cols-3">
              {TRUST.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.titleKey} className="flex flex-col gap-2">
                    <dt className="flex items-center gap-2 font-semibold">
                      <Icon className="size-4 text-accent" aria-hidden />
                      {t(item.titleKey)}
                    </dt>
                    <dd className="text-sm leading-relaxed text-fg-muted">{t(item.bodyKey)}</dd>
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
              <h2 className="text-2xl font-semibold tracking-tight">
                {t('marketing.setUpYourWorkspaceIn')}
              </h2>
              <p className="text-fg-muted">{t('marketing.createAnOrganizationInviteYour')}</p>
            </div>
            <Button asChild size="lg" trailingIcon={<ArrowRight aria-hidden />}>
              <Link href="/register">{t('marketing.createYourWorkspace')}</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={24} />
            <span className="text-sm text-fg-muted">
              {t('common.hilatechDevAllRightsReserved', { year: String(new Date().getFullYear()) })}
            </span>
          </div>
          <nav
            aria-label={t('marketing.footer')}
            className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-muted"
          >
            <Link href="/login" className="hover:text-fg">
              {t('common.signIn')}
            </Link>
            <Link href="/register" className="hover:text-fg">
              {t('common.createAccount')}
            </Link>
            <Link href="/forgot-password" className="hover:text-fg">
              {t('marketing.resetPassword')}
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
async function ConversationLedger() {
  const { t } = await getT();
  return (
    <figure
      aria-label={t('marketing.exampleTheAssistantHandlingA')}
      className="relative rounded-xl border border-border bg-surface p-5 shadow-sm lg:p-6"
    >
      <figcaption className="mb-4 flex items-center justify-between text-xs text-fg-subtle">
        <span>{t('marketing.exampleConversation')}</span>
        <span className="rounded-full border border-border px-2 py-0.5">
          {t('marketing.whatsapp0942')}
        </span>
      </figcaption>
      <ol className="flex flex-col gap-3 text-sm">
        <li className="max-w-[85%] self-start rounded-lg rounded-ss-xs bg-surface-muted px-3.5 py-2.5 text-fg">
          {t('marketing.hiDoYouHaveA')}
        </li>
        <li className="max-w-[85%] self-end rounded-lg rounded-se-xs bg-accent px-3.5 py-2.5 text-accent-fg">
          {t('marketing.yesThursdayAt1730')}
        </li>
        <li className="max-w-[85%] self-start rounded-lg rounded-ss-xs bg-surface-muted px-3.5 py-2.5 text-fg">
          {t('marketing.yesPleaseItSFor')}
        </li>
      </ol>
      <div className="mt-5 border-t border-dashed border-border pt-4">
        <p className="mb-2 text-xs text-fg-subtle">{t('marketing.whatTheAssistantDid')}</p>
        <ul className="flex flex-col gap-1.5 text-sm">
          <li className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-success" aria-hidden />
            {t('marketing.bookedThursday1730Dr')}
          </li>
          <li className="flex items-center gap-2">
            <Target className="size-4 text-success" aria-hidden />
            {t('marketing.createdLeadNoaCleaningSource')}
          </li>
          <li className="flex items-center gap-2">
            <Users className="size-4 text-success" aria-hidden />
            {t('marketing.notifiedTheFrontDesk')}
          </li>
        </ul>
      </div>
    </figure>
  );
}
