/** Middlewares reutilizáveis de sanitização, autenticação e CSRF. */
const sanitizeHtml = require("sanitize-html");

const blockedKeys = new Set(["__proto__", "prototype", "constructor"]);

function sanitize(req, res, next) {
  const clean = (value) => {
    if (typeof value === "string") {
      return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim();
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !blockedKeys.has(key))
          .map(([key, child]) => [key, clean(child)]),
      );
    }
    return value;
  };
  if (req.body) req.body = clean(req.body);
  next();
}
function auth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: "Não autenticado" });
}
function csrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path === "/auth/login" || req.path === "/auth/setup") return next();
  if (req.get("X-CSRF-Token") === req.session?.csrf) return next();
  res.status(403).json({ error: "Token de segurança inválido" });
}
module.exports = { sanitize, auth, csrf };
