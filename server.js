/** Ponto de entrada: configura segurança, rotas da API e arquivos estáticos. */
require("dotenv").config();
const express = require("express"),
  path = require("path"),
  helmet = require("helmet"),
  compression = require("compression"),
  session = require("express-session"),
  rateLimit = require("express-rate-limit"),
  morgan = require("morgan"),
  fs = require("fs"),
  multer = require("multer"),
  Database = require("better-sqlite3"),
  { parse } = require("csv-parse/sync"),
  writeXlsxFile = require("write-excel-file/node");
const authCtrl = require("./controllers/auth"),
  computers = require("./controllers/computers"),
  { auth, csrf, sanitize } = require("./middleware/security"),
  { makePdf } = require("./services/pdf"),
  db = require("./database/schema"),
  SqliteSessionStore = require("./services/sessionStore"),
  logger = require("./services/logger");
// Instância HTTP e diretórios de arquivos gerados pela aplicação.
const app = express(),
  PORT = process.env.PORT || 9090;
["uploads", "backup", "logs"].forEach((x) =>
  fs.mkdirSync(path.join(__dirname, x), { recursive: true }),
);

if (process.env.NODE_ENV === "production") {
  for (const [name, fallback] of [
    ["SESSION_SECRET", "change-this-session-secret"],
    ["ENCRYPTION_KEY", "development-key-change-before-production"],
  ]) {
    if (!process.env[name] || process.env[name] === fallback) {
      throw new Error(`${name} deve ser definido com valor forte em produção`);
    }
  }
}

const fieldLabels = {
  hostname: "Nome do computador",
  department: "Departamento",
  location: "Localização",
  responsible: "Responsável",
  brand: "Marca",
  model: "Modelo",
  serial_number: "Número de Série",
  processor: "Processador",
  ram_gb: "Memória RAM (GB)",
  ram_type: "Tipo de memória",
  storage_type: "Armazenamento principal",
  storage_capacity: "Capacidade do armazenamento",
  operating_system: "Sistema Operacional",
  windows_version: "Versão Windows",
  windows_build: "Build",
  ip_address: "Endereço IP",
};

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  const columns = computers.fields;
  const header = columns.map((field) => fieldLabels[field] || field).join(";");
  const body = rows.map((row) => columns.map((field) => escapeCsv(row[field])).join(";"));
  return [header, ...body].join("\n");
}

function normalizeImportRow(row) {
  const normalized = {};
  for (const field of computers.fields) {
    normalized[field] = row[field] ?? row[fieldLabels[field]] ?? null;
  }
  return normalized;
}

function validateBackupDatabase(filePath) {
  const source = new Database(filePath, { readonly: true, fileMustExist: true });
  const hasTable = (table) =>
    source
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
  for (const table of ["users", "computers", "audit_logs"]) {
    if (!hasTable(table)) throw new Error(`Tabela ausente no backup: ${table}`);
  }
  return source;
}

function copyTable(source, table, columns) {
  db.prepare(`DELETE FROM ${table}`).run();
  const rows = source.prepare(`SELECT ${columns.join(",")} FROM ${table}`).all();
  if (!rows.length) return;
  const placeholders = columns.map(() => "?").join(",");
  const insert = db.prepare(
    `INSERT INTO ${table}(${columns.join(",")}) VALUES(${placeholders})`,
  );
  rows.forEach((row) => insert.run(...columns.map((column) => row[column])));
}
// Camada global: cabeçalhos seguros, compressão, log, parser e sessão.
app.disable("x-powered-by");
app.set("etag", false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://unpkg.com", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);
app.use(compression());
app.use(
  morgan("combined", {
    stream: fs.createWriteStream(path.join(__dirname, "logs", "access.log"), {
      flags: "a",
    }),
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || "change-this-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 28800000,
    },
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 400,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(
  "/api/auth/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    skipSuccessfulRequests: true,
  }),
);
app.use(sanitize);
// Rotas de autenticação e proteção de sessão/CSRF.
app.get("/api/auth/status", authCtrl.status);
app.post("/api/auth/setup", authCtrl.setup);
app.post("/api/auth/login", authCtrl.login);
app.post("/api/auth/logout", auth, csrf, authCtrl.logout);
// API de inventário: leitura, criação, edição, exclusão e duplicação.
app.get("/api/computers", auth, computers.list);
app.get("/api/computers/stats", auth, computers.stats);
app.get("/api/computers/:id", auth, computers.get);
app.post("/api/computers", auth, csrf, computers.create);
app.put("/api/computers/:id", auth, csrf, computers.update);
app.delete("/api/computers/:id", auth, csrf, computers.remove);
app.post("/api/computers/:id/duplicate", auth, csrf, computers.duplicate);
// Saídas portáveis do inventário em CSV, Excel e PDF.
app.get("/api/export/csv", auth, (req, res) => {
  const rows = computers.all();
  res.attachment("inventario.csv");
  res.type("text/csv; charset=utf-8");
  logger.info("exportação CSV", { userId: req.session.user.id, count: rows.length });
  res.send(`\uFEFF${rowsToCsv(rows)}`);
});
app.get("/api/export/excel", auth, asyncRoute(async (req, res) => {
  const rows = computers.all();
  const schema = computers.fields.map((field) => ({
    column: fieldLabels[field] || field,
    type: field === "ram_gb" ? Number : String,
    value: (row) => row[field] ?? "",
  }));
  const buffer = await writeXlsxFile(rows, { schema, buffer: true });
  res.setHeader("Content-Disposition", "attachment; filename=inventario.xlsx");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  logger.info("exportação Excel", { userId: req.session.user.id, count: rows.length });
  res.send(buffer);
}));
app.get("/api/export/pdf", auth, (req, res) =>
  makePdf(res, computers.all(), process.env.COMPANY_NAME || "Inventário de TI"),
);
app.get("/api/computers/:id/pdf", auth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });
  const c = db.prepare("SELECT * FROM computers WHERE id=?").get(id);
  if (!c) return res.status(404).json({ error: "Computador não encontrado" });
  makePdf(res, [c], process.env.COMPANY_NAME || "Inventário de TI");
});
// Upload limitado para importação de planilhas.
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, [".csv", ".db", ".sqlite"].includes(ext));
  },
});
app.post("/api/import/csv", auth, csrf, upload.single("file"), (req, res) => {
  try {
    if (!req.file || path.extname(req.file.originalname).toLowerCase() !== ".csv") {
      return res.status(400).json({ error: "Envie um arquivo CSV válido" });
    }
    const rows = parse(fs.readFileSync(req.file.path), {
      bom: true,
      columns: true,
      delimiter: [";", ","],
      skip_empty_lines: true,
      trim: true,
    });
    let count = 0;
    const cols = computers.fields;
    const stmt = db.prepare(
      `INSERT INTO computers(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`,
    );
    const tx = db.transaction(() =>
      rows.forEach((row) => {
        const normalized = normalizeImportRow(row);
        if (normalized.hostname && normalized.department && normalized.location) {
          stmt.run(...cols.map((k) => normalized[k] ?? null));
          count++;
        }
      }),
    );
    tx();
    fs.unlinkSync(req.file.path);
    logger.info("importação CSV", { userId: req.session.user.id, count });
    res.json({ count });
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    logger.warn("falha na importação CSV", { error: e.message });
    res.status(400).json({
      error:
        "Arquivo inválido. Use um CSV exportado pelo sistema ou com os mesmos cabeçalhos.",
    });
  }
});
app.get("/api/backup", auth, (req, res) =>
  res.download(
    path.join(__dirname, "database", "inventory.db"),
    "backup-inventario.db",
  ),
);
app.post("/api/restore", auth, csrf, upload.single("file"), (req, res) => {
  try {
    if (!req.file || ![".db", ".sqlite"].includes(path.extname(req.file.originalname).toLowerCase())) {
      return res.status(400).json({ error: "Envie um backup SQLite válido" });
    }
    const source = validateBackupDatabase(req.file.path);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(
      path.join(__dirname, "database", "inventory.db"),
      path.join(__dirname, "backup", `antes-restauracao-${stamp}.db`),
    );
    db.transaction(() => {
      copyTable(source, "audit_logs", ["id", "user_id", "action", "entity", "entity_id", "details", "created_at"]);
      copyTable(source, "computers", ["id", ...computers.fields, "computer_password", "created_at", "updated_at"].filter((v, i, a) => a.indexOf(v) === i));
      copyTable(source, "users", ["id", "name", "email", "password", "role", "created_at"]);
    })();
    source.close();
    fs.unlinkSync(req.file.path);
    logger.warn("backup restaurado", { userId: req.session.user.id });
    req.session.destroy(() => res.json({ ok: true, message: "Backup restaurado. Faça login novamente." }));
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    logger.error("falha na restauração de backup", { error: e.message });
    res.status(400).json({ error: "Não foi possível restaurar este backup" });
  }
});
// Frontend SPA e tratamento final de erros inesperados.
app.use(express.static(path.join(__dirname, "public"), { etag: false, maxAge: 0 }));
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);
app.use((err, req, res, next) => {
  logger.error("erro não tratado", {
    method: req.method,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: "Erro interno do servidor" });
});
process.on("unhandledRejection", (error) =>
  logger.error("promise rejeitada sem tratamento", { error: error.message, stack: error.stack }),
);
process.on("uncaughtException", (error) =>
  logger.error("exceção não capturada", { error: error.message, stack: error.stack }),
);

app.listen(PORT, () => {
  logger.info("servidor iniciado", { port: PORT, environment: process.env.NODE_ENV || "development" });
  console.log(`Inventário disponível em http://localhost:${PORT}`);
});
