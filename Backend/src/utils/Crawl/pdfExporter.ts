import PDFDocument from 'pdfkit';
import * as fs from 'fs';

export interface ExtractedContent {
  url: string;
  type: 'webpage' | 'pdf' | 'docx' | 'xlsx' | 'unknown';
  title: string | null;
  content: string;
}

export async function exportToPdf(contentArray: ExtractedContent[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    doc.fontSize(20).text('AstroLynx MOSDAC Data Export', { align: 'center' });
    doc.fontSize(10).text(`Exported: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown();

    contentArray.forEach((item, index) => {
      if (index > 0) doc.addPage();
      doc.fontSize(12).fillColor('blue').text(item.url, { underline: true });
      doc.fontSize(10).fillColor('black').text(`Type: ${item.type}`);
      if (item.title) doc.text(`Title: ${item.title}`);
      doc.moveDown(0.5);
      doc.fontSize(9).text(item.content, { align: 'left' });
      doc.moveDown(1);
    });

    doc.end();

    stream.on('finish', () => {
      console.log(`PDF exported to ${outputPath}`);
      resolve();
    });
    stream.on('error', reject);
  });
}
