import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField } from '../components/form-field';
import { Input } from '../components/input';

describe('FormField', () => {
  it('links label, description and error to the control', () => {
    render(
      <FormField
        id="email"
        label="Email"
        description="Work email preferred"
        error="Enter a valid email"
      >
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('id', 'email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain('email-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });

  it('marks required fields', () => {
    render(
      <FormField id="name" label="Name" required>
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('aria-required', 'true');
  });
});
