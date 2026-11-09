import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, parseBlocks } from '../markdown';

describe('Markdown', () => {
  it('renders paragraphs, lists, inline code and fenced code', () => {
    const { container } = render(
      <Markdown
        source={
          'Hello **world** and `code`\n\n- one\n- two\n\n1. first\n2. second\n\n```ts\nconst a = 1;\n```'
        }
      />,
    );
    expect(screen.getByText('world').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
  });

  it('never injects HTML and only links http(s)/mailto', () => {
    const { container } = render(
      <Markdown
        source={
          '<img src=x onerror=alert(1)> <script>alert(1)</script> [bad](javascript:alert(1)) [ok](https://example.com)'
        }
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com');
    expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('keeps an unterminated fence as code while streaming', () => {
    expect(parseBlocks('```js\nlet x')).toEqual([{ type: 'code', lang: 'js', code: 'let x' }]);
  });
});
