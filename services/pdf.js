/** Gera relatório PDF paginado e formatado para impressão. */
const PDFDocument = require("pdfkit");
function makePdf(res, items, company) {
  const doc = new PDFDocument({ layout: "landscape", margin: 32, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=inventario.pdf");
  doc.pipe(res);
  doc.fontSize(19).fillColor("#0f172a").text(company);
  doc
    .fontSize(10)
    .fillColor("#64748b")
    .text(
      `Inventário de computadores • Gerado em ${new Date().toLocaleString("pt-BR")}`,
    );
  doc.moveDown();
  const cols = [
    ["Hostname", 70],
    ["Departamento", 70],
    ["Localização", 65],
    ["Responsável", 70],
    ["Marca / Modelo", 80],
    ["Nº Série", 70],
    ["Sistema", 70],
    ["Processador", 90],
    ["RAM", 34],
    ["Armaz.", 60],
    ["IP", 65],
  ];
  function header() {
    let x = 32;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#fff");
    doc.rect(32, doc.y, 780, 16).fill("#0f172a");
    cols.forEach(([n, w]) => {
      doc.fillColor("#fff").text(n, x + 3, doc.y + 4, { width: w - 5 });
      x += w;
    });
    doc.moveDown(1.6);
  }
  function row(c, i) {
    if (doc.y > 530) {
      doc.addPage();
      header();
    }
    let x = 32,
      y = doc.y;
    doc.font("Helvetica").fontSize(6.6).fillColor("#334155");
    if (i % 2 === 0) doc.rect(32, y, 780, 20).fill("#f1f5f9");
    const vals = [
      c.hostname,
      c.department,
      c.location,
      c.responsible,
      `${c.brand || ""} ${c.model || ""}`,
      c.serial_number,
      c.operating_system,
      c.processor,
      `${c.ram_gb || ""} GB`,
      `${c.storage_type || ""} ${c.storage_capacity || ""}`,
      c.ip_address,
    ];
    cols.forEach(([_, w], j) => {
      doc.fillColor("#334155").text(String(vals[j] || "—"), x + 3, y + 6, {
        width: w - 5,
        height: 12,
        ellipsis: true,
      });
      x += w;
    });
    doc.y = y + 20;
  }
  header();
  items.forEach(row);
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(7)
      .fillColor("#64748b")
      .text(`Página ${i + 1} de ${range.count}`, 32, 565, {
        align: "right",
        width: 780,
      });
  }
  doc.end();
}
module.exports = { makePdf };
