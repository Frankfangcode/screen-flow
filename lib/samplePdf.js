'use strict';

// Minimal 16:9 PDF with three colored slides. Standard Helvetica only, so it
// stays valid without embedded fonts. Built-in HTML slides carry the Chinese
// title cards; this file is the pdf.js fixture and the one-click sample deck.

function buildSamplePdf() {
  const pages = [
    contentStream([
      '0.09 0.08 0.07 rg',
      '0 0 1280 720 re f',
      '0.90 0.64 0.13 rg',
      '80 470 210 8 re f',
      '1 1 1 rg',
      'BT /F1 54 Tf 80 400 Td (Live Danmaku) Tj ET',
      'BT /F1 22 Tf 80 348 Td (2026-11-24  18:00  Taipei) Tj ET',
      'BT /F1 18 Tf 80 300 Td (Sample PDF  -  page 1 of 3) Tj ET',
    ]),
    contentStream([
      '0.96 0.94 0.89 rg',
      '0 0 1280 720 re f',
      '0.89 0.24 0.17 rg',
      '80 500 64 8 re f',
      '0.10 0.09 0.08 rg',
      'BT /F1 48 Tf 80 430 Td (How to join) Tj ET',
      'BT /F1 24 Tf 80 360 Td (1  Scan the QR code) Tj ET',
      'BT /F1 24 Tf 80 320 Td (2  Pick size, color, motion) Tj ET',
      'BT /F1 24 Tf 80 280 Td (3  Send one line, or an emoji) Tj ET',
    ]),
    contentStream([
      '0.07 0.16 0.13 rg',
      '0 0 1280 720 re f',
      '0.49 0.86 0.70 rg',
      '80 470 120 8 re f',
      '0.96 0.94 0.89 rg',
      'BT /F1 46 Tf 80 400 Td (Be kind on screen.) Tj ET',
      'BT /F1 22 Tf 80 340 Td (Filtered words never leave the server.) Tj ET',
      'BT /F1 18 Tf 80 292 Td (Sample PDF  -  page 3 of 3) Tj ET',
    ]),
  ];
  return assemblePdf(pages);
}

function contentStream(lines) {
  return lines.join('\n');
}

function assemblePdf(streams) {
  const objects = [];
  const offsets = [0];
  const chunks = ['%PDF-1.4\n'];

  function add(id, body) {
    offsets[id] = Buffer.byteLength(chunks.join(''), 'utf8');
    chunks.push(`${id} 0 obj\n${body}\nendobj\n`);
  }

  const n = streams.length;
  const kids = [];
  for (let i = 0; i < n; i += 1) kids.push(`${4 + i * 2} 0 R`);

  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`);
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  streams.forEach((stream, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const data = stream.endsWith('\n') ? stream : `${stream}\n`;
    const length = Buffer.byteLength(data, 'utf8');
    add(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1280 720] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
    );
    add(contentId, `<< /Length ${length} >>\nstream\n${data}endstream`);
  });

  const total = 3 + n * 2;
  const xrefAt = Buffer.byteLength(chunks.join(''), 'utf8');
  let xref = `xref\n0 ${total + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= total; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(xref);
  return Buffer.from(chunks.join(''), 'utf8');
}

module.exports = { buildSamplePdf };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const out = process.argv[2] || path.join(__dirname, '..', 'public', 'sample', 'workshop.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildSamplePdf());
  console.log('wrote', out);
}
