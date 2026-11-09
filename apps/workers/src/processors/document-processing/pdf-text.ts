import type { PdfTextExtractor } from '@hilatech/ai-engine';

/**
 * Page-aware PDF text extraction through `pdf-parse`. Loaded lazily: if the library cannot be imported
 * (missing native pieces on an exotic platform) PDFs fail with a clear "not available" error instead of
 * crashing the worker at boot.
 */
export async function loadPdfExtractor(): Promise<PdfTextExtractor | null> {
  try {
    const { PDFParse } = await import('pdf-parse');
    return async (data) => {
      const parser = new PDFParse({ data: new Uint8Array(data) });
      try {
        const result = await parser.getText();
        return { pages: result.pages.map((page) => page.text) };
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    };
  } catch {
    return null;
  }
}
