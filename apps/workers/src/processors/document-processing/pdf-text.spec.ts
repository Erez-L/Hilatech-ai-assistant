import { makePdf } from '../../../test/helpers/make-pdf';
import { loadPdfExtractor } from './pdf-text';

describe('loadPdfExtractor', () => {
  it('extracts text page by page from a real PDF', async () => {
    const extract = await loadPdfExtractor();
    expect(extract).not.toBeNull();
    const { pages } = await extract!(
      makePdf(['Refund policy thirty days', 'Shipping takes five days']),
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Refund policy thirty days');
    expect(pages[1]).toContain('Shipping takes five days');
    expect(pages.join('\n')).not.toMatch(/-- \d+ of \d+ --/);
  });

  it('rejects data that is not a PDF', async () => {
    const extract = await loadPdfExtractor();
    await expect(extract!(Buffer.from('definitely not a pdf'))).rejects.toThrow();
  });
});
