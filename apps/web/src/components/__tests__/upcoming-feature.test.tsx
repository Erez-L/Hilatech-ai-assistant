import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Target } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

describe('UpcomingFeature', () => {
  it('renders the shared placeholder without any fabricated data', () => {
    render(
      <UpcomingFeature
        title="Leads"
        description="Pipeline."
        icon={Target}
        milestone="Core business"
        capabilities={['Stages from new to won.', 'Assignment to teammates.']}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Leads' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Available in an upcoming milestone' })).toBeInTheDocument();
    expect(screen.getByText(/Core business milestone/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Back to dashboard/ })).toHaveAttribute('href', '/dashboard');
  });
});
