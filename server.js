/** Ponto de entrada: configura segurança, rotas da API e arquivos estáticos. */
require("dotenv").config();
const express = require("express"),
  http = require("http"),
  https = require("https"),
  path = require("path"),
  helmet = require("helmet"),
  compression = require("compression"),
  cors = require("cors"),
  cookieParser = require("cookie-parser"),
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
const { registerShutdownHandlers, startNgrok } = require("./services/ngrok");
// Instância HTTP e diretórios de arquivos gerados pela aplicação.
const app = express(),
  PORT = Number(process.env.PORT || 9090),
  HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT);
let activeHttpsPort = HTTPS_PORT;
let activeHttpPort = HTTP_PORT;
const isServerless = Boolean(process.env.VERCEL);
const runtimeDir = isServerless ? "/tmp" : __dirname;
const runtimePath = (...parts) => path.join(runtimeDir, ...parts);
const sslKeyPath = process.env.SSL_KEY || path.join(__dirname, "certificados", "server.key");
const sslCertPath = process.env.SSL_CERT || path.join(__dirname, "certificados", "server.crt");
const sslCaPath = process.env.SSL_CA || path.join(__dirname, "certificados", "ca.crt");
function loadHttpsOptions() {
  const options = {
    key: fs.readFileSync(sslKeyPath),
    cert: fs.readFileSync(sslCertPath),
  };
  if (fs.existsSync(sslCaPath)) {
    options.ca = fs.readFileSync(sslCaPath);
  }
  return options;
}
let httpsOptions;
try {
  httpsOptions = loadHttpsOptions();
} catch (error) {
  logger.warn("falha ao carregar certificados HTTPS", { error: error.message });
  httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, "certificados", "server.key")),
    cert: fs.readFileSync(path.join(__dirname, "certificados", "server.crt")),
  };
}
["uploads", "backup", "logs", "certificados"].forEach((x) =>
  fs.mkdirSync(runtimePath(x), { recursive: true }),
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
  proprietary: "Nome do proprietário",
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
  ip_address: "Endereço IP ou MAC",
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
  const body = rows.map((row) =>
    columns.map((field) => escapeCsv(row[field])).join(";"),
  );
  return [header, ...body].join("\n");
}

function normalizeImportRow(row) {
  const normalized = {};
  for (const field of computers.fields) {
    normalized[field] = row[field] ?? row[fieldLabels[field]] ?? null;
  }
  return normalized;
}

function resolveCompanyName(req) {
  return req.session?.user?.company_name || process.env.COMPANY_NAME || "Inventário de TI";
}

function validateBackupDatabase(filePath) {
  const source = new Database(filePath, {
    readonly: true,
    fileMustExist: true,
  });
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
  const rows = source
    .prepare(`SELECT ${columns.join(",")} FROM ${table}`)
    .all();
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
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.tailwindcss.com",
          "https://unpkg.com",
          "https://cdn.jsdelivr.net",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
app.use((req, res, next) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto !== "https" && !req.secure) {
    const host = req.headers.host?.split(":")[0] || "localhost";
    return res.redirect(301, `https://${host}:${activeHttpsPort}${req.url}`);
  }
  next();
});
app.use(compression());
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  }),
);
app.use(cookieParser());
app.use(
  morgan("combined", {
    stream: isServerless
      ? process.stdout
      : fs.createWriteStream(runtimePath("logs", "access.log"), { flags: "a" }),
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
  logger.info("exportação CSV", {
    userId: req.session.user.id,
    count: rows.length,
  });
  res.send(`\uFEFF${rowsToCsv(rows)}`);
});
app.get(
  "/api/export/excel",
  auth,
  asyncRoute(async (req, res) => {
    const rows = computers.all();
    const columns = computers.fields.map((field) => ({
      header: { value: fieldLabels[field] || field, fontWeight: "bold" },
      width: Math.max(14, (fieldLabels[field] || field).length + 2),
      cell: (row) => ({
        value:
          field === "ram_gb" && row[field] !== null && row[field] !== undefined
            ? Number(row[field])
            : String(row[field] ?? ""),
        type: field === "ram_gb" ? Number : String,
      }),
    }));
    const buffer = await writeXlsxFile(rows, { columns }).toBuffer();
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=inventario.xlsx",
    );
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    logger.info("exportação Excel", {
      userId: req.session.user.id,
      count: rows.length,
    });
    res.send(buffer);
  }),
);
app.get("/api/export/pdf", auth, (req, res) =>
  makePdf(res, computers.all(), resolveCompanyName(req)),
);
app.get("/api/computers/:id/pdf", auth, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0)
    return res.status(400).json({ error: "ID inválido" });
  const c = db.prepare("SELECT * FROM computers WHERE id=?").get(id);
  if (!c) return res.status(404).json({ error: "Computador não encontrado" });
  makePdf(res, [c], resolveCompanyName(req));
});
// Upload limitado para importação de planilhas.
const upload = multer({
  dest: runtimePath("uploads"),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, [".csv", ".db", ".sqlite"].includes(ext));
  },
});
app.post("/api/import/csv", auth, csrf, upload.single("file"), (req, res) => {
  try {
    if (
      !req.file ||
      path.extname(req.file.originalname).toLowerCase() !== ".csv"
    ) {
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
        if (
          normalized.hostname &&
          normalized.department &&
          normalized.location
        ) {
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
    if (req.file?.path && fs.existsSync(req.file.path))
      fs.unlinkSync(req.file.path);
    logger.warn("falha na importação CSV", { error: e.message });
    res.status(400).json({
      error:
        "Arquivo inválido. Use um CSV exportado pelo sistema ou com os mesmos cabeçalhos.",
    });
  }
});
app.get("/api/backup", auth, (req, res) =>
  res.download(
    process.env.DATABASE_PATH ||
      (isServerless
        ? "/tmp/inventory.db"
        : path.join(__dirname, "database", "inventory.db")),
    "backup-inventario.db",
  ),
);
app.post("/api/restore", auth, csrf, upload.single("file"), (req, res) => {
  try {
    if (
      !req.file ||
      ![".db", ".sqlite"].includes(
        path.extname(req.file.originalname).toLowerCase(),
      )
    ) {
      return res.status(400).json({ error: "Envie um backup SQLite válido" });
    }
    const source = validateBackupDatabase(req.file.path);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    db.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(
      process.env.DATABASE_PATH ||
        (isServerless
          ? "/tmp/inventory.db"
          : path.join(__dirname, "database", "inventory.db")),
      runtimePath("backup", `antes-restauracao-${stamp}.db`),
    );
    db.transaction(() => {
      copyTable(source, "audit_logs", [
        "id",
        "user_id",
        "action",
        "entity",
        "entity_id",
        "details",
        "created_at",
      ]);
      copyTable(
        source,
        "computers",
        [
          "id",
          ...computers.fields,
          "computer_password",
          "created_at",
          "updated_at",
        ].filter((v, i, a) => a.indexOf(v) === i),
      );
      copyTable(source, "users", [
        "id",
        "name",
        "email",
        "password",
        "role",
        "created_at",
      ]);
    })();
    source.close();
    fs.unlinkSync(req.file.path);
    logger.warn("backup restaurado", { userId: req.session.user.id });
    req.session.destroy(() =>
      res.json({
        ok: true,
        message: "Backup restaurado. Faça login novamente.",
      }),
    );
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path))
      fs.unlinkSync(req.file.path);
    logger.error("falha na restauração de backup", { error: e.message });
    res.status(400).json({ error: "Não foi possível restaurar este backup" });
  }
});
// Frontend SPA e tratamento final de erros inesperados.
app.use(
  express.static(path.join(__dirname, "public"), { etag: false, maxAge: 0 }),
);
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
module.exports = app;

if (!isServerless) {
  registerShutdownHandlers(logger);

  function startHttpServer(port, fallbackStart) {
    const maxAttempts = 5;
    const tryListen = (currentPort, attempt) => {
      const server = http.createServer(app);
      const onError = (error) => {
        if (error.code === "EADDRINUSE" && attempt < maxAttempts) {
          logger.warn("porta HTTP ocupada, tentando próxima", {
            port: currentPort,
            nextPort: currentPort + 1,
          });
          server.close();
          return tryListen(currentPort + 1, attempt + 1);
        }
        if (error.code === "EACCES") {
          logger.warn("porta HTTP sem permissão", { port: currentPort });
          return;
        }
        logger.error("erro no servidor HTTP", { error: error.message });
      };
      server.on("error", onError);
      server.listen(currentPort, "0.0.0.0", () => {
        server.removeListener("error", onError);
        activeHttpPort = currentPort;
        logger.info("servidor HTTP iniciado para redirecionamento", {
          port: currentPort,
        });
        if (typeof fallbackStart === "function") fallbackStart(currentPort);
      });
    };
    tryListen(port, 0);
  }

  function startHttpsServer(port) {
    const maxAttempts = 5;
    const tryListen = (currentPort, attempt) => {
      const server = https.createServer(httpsOptions, app);
      const onError = (error) => {
        if (error.code === "EADDRINUSE" && attempt < maxAttempts) {
          logger.warn("porta HTTPS ocupada, tentando próxima", {
            port: currentPort,
            nextPort: currentPort + 1,
          });
          server.close();
          return tryListen(currentPort + 1, attempt + 1);
        }
        logger.error("erro no servidor HTTPS", { error: error.message });
        process.exitCode = 1;
      };
      server.on("error", onError);
      server.listen(currentPort, "0.0.0.0", async () => {
        server.removeListener("error", onError);
        logger.info("servidor HTTPS iniciado", {
          port: currentPort,
          environment: process.env.NODE_ENV || "development",
        });
        activeHttpsPort = currentPort;
        const publicUrl = await startNgrok(currentPort);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("🚀 Servidor iniciado com sucesso");
        console.log(`🔐 HTTPS:    https://localhost:${currentPort}`);
        console.log(`🔁 HTTP:     http://localhost:${activeHttpPort} -> https://localhost:${currentPort}`);
        if (publicUrl) console.log(`🔗 Ngrok:    ${publicUrl}`);
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      });
    };
    tryListen(port, 0);
  }

  startHttpsServer(PORT);
  startHttpServer(HTTP_PORT);
}
