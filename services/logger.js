/** Logger simples em arquivo para auditoria operacional e erros de produção. */
const fs = require("fs");
const path = require("path");

const isServerless = Boolean(process.env.VERCEL);
const logDir = isServerless ? null : path.join(__dirname, "..", "logs");
if (logDir) fs.mkdirSync(logDir, { recursive: true });

function write(level, message, meta = {}) {
  const entry = {
    at: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  if (isServerless) console.log(JSON.stringify(entry));
  else fs.appendFileSync(path.join(logDir, "application.log"), `${JSON.stringify(entry)}\n`);
}

module.exports = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};
