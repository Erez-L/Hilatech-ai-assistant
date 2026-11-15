import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '@/i18n/messages';
import { he } from '@/i18n/messages/he';
import { NAV_AREAS } from '@/components/shell/nav';

let pathname = '/leads';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { ScreenGuide, ScreenGuideButton } from '@/components/shell/screen-guide';

describe('first-visit guide', () => {
  beforeEach(() => {
    pathname = '/leads';
  });

  it('every screen of the navigation has a guide in both languages', () => {
    for (const item of NAV_AREAS.flatMap((area) => area.items)) {
      const key = item.href.replace(/^\//, '');
      for (const part of ['what', 'step1', 'step2', 'step3']) {
        expect(en, `en ${key}.${part}`).toHaveProperty([`guide.${key}.${part}`]);
        expect(he, `he ${key}.${part}`).toHaveProperty([`guide.${key}.${part}`]);
      }
    }
  });

  it('shows on the first visit, stays hidden after "Got it", and the help button brings it back', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <>
        <ScreenGuideButton />
        <ScreenGuide />
      </>,
    );
    const guide = await screen.findByRole('region', { name: 'Guide to this screen' });
    expect(guide).toHaveTextContent('A lead is a sales opportunity');
    await user.click(screen.getAllByRole('button', { name: 'Got it' })[1]!);
    expect(screen.queryByRole('region', { name: 'Guide to this screen' })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('hta.guide.v1')!)).toMatchObject({
      seen: ['leads'],
    });

    // Another screen still shows its own guide; the dismissed one stays hidden on a later visit.
    unmount();
    pathname = '/deals';
    const second = render(<ScreenGuide />);
    expect(await screen.findByRole('region', { name: 'Guide to this screen' })).toHaveTextContent(
      'A deal is a sale in progress',
    );
    second.unmount();
    pathname = '/leads';
    render(
      <>
        <ScreenGuideButton />
        <ScreenGuide />
      </>,
    );
    expect(screen.queryByRole('region', { name: 'Guide to this screen' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'What is this screen?' }));
    expect(screen.getByRole('region', { name: 'Guide to this screen' })).toBeInTheDocument();
  });
});
