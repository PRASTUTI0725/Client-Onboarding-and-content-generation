/**
 * pdf-parse v2 exports a `PDFParse` class; v1 used a default function.
 * This helper tries v2 first, then legacy, so different installs keep working.
 */

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfModule = (await import("pdf-parse")) as {
    default?: (data: Buffer) => Promise<{ text?: string }>;
    PDFParse?: new (opts: { data: Buffer }) => {
      getText: (o?: object) => Promise<{ text?: string }>;
      destroy: () => Promise<void>;
    };
  };

  if (typeof pdfModule.PDFParse === "function") {
    try {
      const parser = new pdfModule.PDFParse({ data: buffer });
      const parsed = await parser.getText({ disableWorker: true } as Record<string, unknown>);
      const text = (parsed.text ?? "").trim();
      try {
        await parser.destroy();
      } catch {
        /* ignore */
      }
      if (text.length > 0) return text;
    } catch {
      /* try legacy */
    }
  }
  if (typeof pdfModule.default === "function") {
    const parsed = await pdfModule.default(buffer);
    return (parsed.text ?? "").trim();
  }
  throw new Error("Could not find a working pdf-parse entry point (PDFParse or default export).");
}
