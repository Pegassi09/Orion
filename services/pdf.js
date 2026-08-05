/** Gera relatório PDF paginado e formatado para impressão. */
const PDFDocument = require("pdfkit");

const PAGE_MARGIN = 32;
const FOOTER_Y = 550;
const TABLE_WIDTH = 776;
const VALUE_FONT_SIZE = 6.5;
const CELL_PADDING = 4;

// As larguras ocupam a área útil de uma folha A4 na orientação paisagem.
const columns = [
  ["Nº", 22],
  ["Nome do equipamento", 65],
  ["Departamento", 60],
  ["Localização", 60],
  ["Responsável", 70],
  ["Nome do proprietário", 70],
  ["Marca / modelo", 66],
  ["Número de série", 64],
  ["Sistema operacional", 60],
  ["Processador", 76],
  ["Memória RAM", 36],
  ["Armazenamento", 62],
  ["Endereço IP ou MAC", 65],
];

function display(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function valuesFor(computer, position) {
  return [
    position,
    computer.hostname,
    computer.department,
    computer.location,
    computer.responsible,
    computer.proprietary,
    [computer.brand, computer.model].filter(Boolean).join(" "),
    computer.serial_number,
    computer.operating_system,
    computer.processor,
    computer.ram_gb ? `${computer.ram_gb} GB` : "",
    [computer.storage_type, computer.storage_capacity]
      .filter(Boolean)
      .join(" "),
    computer.ip_address,
  ].map(display);
}

function makePdf(res, items, company) {
  const doc = new PDFDocument({
    layout: "landscape",
    margin: PAGE_MARGIN,
    size: "A4",
    bufferPages: true,
  });
  const documentCompany = company || "Inventário de TI";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline; filename=inventario.pdf");
  doc.pipe(res);

  let y = 0;

  function drawTableHeader() {
    const headerHeight = 24;
    let x = PAGE_MARGIN;
    doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, headerHeight).fill("#0f172a");
    doc.font("Helvetica-Bold").fontSize(6.4).fillColor("#ffffff");
    columns.forEach(([label, width]) => {
      doc.text(label, x + CELL_PADDING, y + 5, {
        width: width - CELL_PADDING * 2,
        align: "left",
      });
      x += width;
    });
    y += headerHeight;
  }

  function drawPageHeader(firstPage) {
    if (firstPage) {
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .fillColor("#0f172a")
        .text(documentCompany, PAGE_MARGIN, 30, {
          width: TABLE_WIDTH,
        });
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#64748b")
        .text(
          `Inventário de computadores • Gerado em ${new Date().toLocaleString("pt-BR")}`,
          PAGE_MARGIN,
          55,
          {
            width: TABLE_WIDTH,
          },
        );
      y = 76;
    } else {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#0f172a")
        .text(documentCompany, PAGE_MARGIN, 28, {
          width: TABLE_WIDTH,
        });
      y = 43;
    }
    drawTableHeader();
  }

  function rowHeight(values) {
    doc.font("Helvetica").fontSize(VALUE_FONT_SIZE);
    const tallestCell = columns.reduce((height, [, width], index) => {
      const cellHeight = doc.heightOfString(values[index], {
        width: width - CELL_PADDING * 2,
        lineGap: 1,
      });
      return Math.max(height, cellHeight);
    }, 0);
    return Math.max(22, Math.ceil(tallestCell) + CELL_PADDING * 2);
  }

  function drawRow(values, index, height) {
    let x = PAGE_MARGIN;
    if (index % 2 === 0)
      doc.rect(PAGE_MARGIN, y, TABLE_WIDTH, height).fill("#f1f5f9");
    doc.font("Helvetica").fontSize(VALUE_FONT_SIZE).fillColor("#334155");
    columns.forEach(([, width], columnIndex) => {
      doc.text(values[columnIndex], x + CELL_PADDING, y + CELL_PADDING, {
        width: width - CELL_PADDING * 2,
        lineGap: 1,
      });
      x += width;
    });
    y += height;
  }

  drawPageHeader(true);
  items.forEach((computer, index) => {
    const values = valuesFor(computer, index + 1);
    const height = rowHeight(values);
    if (y + height > FOOTER_Y - 12) {
      doc.addPage();
      drawPageHeader(false);
    }
    drawRow(values, index, height);
  });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#64748b")
      .text(
        `Página ${index - range.start + 1} de ${range.count}`,
        PAGE_MARGIN,
        FOOTER_Y,
        {
          align: "right",
          width: TABLE_WIDTH,
        },
      );
  }
  doc.end();
}

module.exports = { makePdf };
