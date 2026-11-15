'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { CircleHelp, X } from 'lucide-react';
import { Button, IconButton } from '@hilatech/ui';
import { useT } from '@/i18n/provider';
import { en, type MessageKey } from '@/i18n/messages';
import type { Msg } from '@/i18n/msg';
import { navItemFor } from './nav';

/**
 * First-visit guide. The first time a person opens a screen, a short card above the page says what the
 * screen is for and how to start. "Got it" hides it for that screen; the help button in the top bar shows
 * it again. What was seen is remembered in this browser only (no server state).
 */
const STORAGE_KEY = 'hta.guide.v1';

interface GuideState {
  seen: string[];
  off: boolean;
  /** Screen the person asked to see again; not persisted. */
  forced: string | null;
  loaded: boolean;
}

let state: GuideState = { seen: [], off: false, forced: null, loaded: false };
const listeners = new Set<() => void>();

function emit(next: GuideState, persist = true) {
  state = next;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ seen: next.seen, off: next.off }));
    } catch {
      // Storage can be unavailable (private mode); the guide then simply shows again next time.
    }
  }
  listeners.forEach((listener) => listener());
}

function load() {
  if (state.loaded) return;
  let saved: { seen?: unknown; off?: unknown } = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as typeof saved;
  } catch {
    saved = {};
  }
  emit(
    {
      seen: Array.isArray(saved.seen)
        ? saved.seen.filter((x): x is string => typeof x === 'string')
        : [],
      off: saved.off === true,
      forced: null,
      loaded: true,
    },
    false,
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useGuideState(): GuideState {
  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  React.useEffect(load, []);
  return snapshot;
}

const hasKey = (key: string): key is MessageKey => Object.prototype.hasOwnProperty.call(en, key);

/** `/leads` → `leads`; a screen has a guide when its texts exist. */
function guideKeyFor(pathname: string): { key: string; label: Msg } | null {
  const item = navItemFor(pathname);
  if (!item) return null;
  const key = item.href.replace(/^\//, '');
  return hasKey(`guide.${key}.what`) ? { key, label: item.label } : null;
}

export function ScreenGuide() {
  const t = useT();
  const pathname = usePathname();
  const guide = guideKeyFor(pathname);
  const { seen, off, forced, loaded } = useGuideState();
  if (!guide || !loaded) return null;
  const visible = forced === guide.key || (!off && !seen.includes(guide.key));
  if (!visible) return null;

  const steps = [1, 2, 3]
    .map((n) => `guide.${guide.key}.step${n}`)
    .filter(hasKey)
    .map((key) => t(key));
  const markSeen = (patch: Partial<GuideState> = {}) =>
    emit({
      ...state,
      seen: state.seen.includes(guide.key) ? state.seen : [...state.seen, guide.key],
      forced: null,
      ...patch,
    });

  return (
    <section
      aria-label={t('guide.region')}
      className="screen-guide relative mb-3 animate-rise rounded-lg border-2 border-tone bg-surface p-4 shadow-xs"
    >
      <IconButton
        label={t('guide.gotIt')}
        onClick={() => markSeen()}
        className="absolute end-2 top-2"
      >
        <X aria-hidden />
      </IconButton>
      <div className="flex items-start gap-3 pe-8">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-tone text-tone-on [&_svg]:size-5">
          <CircleHelp aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-base font-extrabold text-fg">
            {t('guide.title', { screen: t(guide.label) })}
          </h2>
          <p className="text-sm text-fg">{t(`guide.${guide.key}.what` as MessageKey)}</p>
          <p className="text-xs font-bold text-tone-fg">{t('guide.steps')}</p>
          <ol className="flex flex-col gap-1.5 text-sm text-fg">
            {steps.map((step, index) => (
              <li key={step} className="flex items-start gap-2">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-tone text-2xs font-bold text-tone-on">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => markSeen()}>
              {t('guide.gotIt')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => markSeen({ off: true })}>
              {t('guide.hideAll')}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Top-bar button that shows the guide of the current screen again. Hidden on screens without a guide. */
export function ScreenGuideButton() {
  const t = useT();
  const pathname = usePathname();
  const guide = guideKeyFor(pathname);
  useGuideState();
  if (!guide) return null;
  return (
    <IconButton
      label={t('guide.show')}
      onClick={() => {
        emit({ ...state, forced: guide.key }, false);
        document.getElementById('main')?.scrollTo?.({ top: 0 });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
    >
      <CircleHelp aria-hidden />
    </IconButton>
  );
}
