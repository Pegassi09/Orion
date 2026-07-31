/** Controlador de setup inicial, login, logout e token CSRF da sessão. */
const db = require("../database/schema"),
  bcrypt = require("bcryptjs"),
  crypto = require("crypto"),
  logger = require("../services/logger");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.user = user;
      req.session.csrf = crypto.randomBytes(32).toString("hex");
      resolve({ user: req.session.user, csrf: req.session.csrf });
    });
  });
}

exports.status = (req, res) =>
  res.json({
    user: req.session.user || null,
    csrf: req.session.csrf,
    needsSetup: !db.prepare("SELECT id FROM users LIMIT 1").get(),
  });
exports.setup = async (req, res) => {
  if (db.prepare("SELECT id FROM users LIMIT 1").get())
    return res.status(409).json({ error: "Sistema já configurado" });
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!name || !emailPattern.test(email) || !password || password.length < 8)
    return res
      .status(422)
      .json({ error: "Informe nome, e-mail válido e senha de ao menos 8 caracteres" });
  const r = db
    .prepare("INSERT INTO users(name,email,password) VALUES(?,?,?)")
    .run(name, email, await bcrypt.hash(password, 12));
  logger.info("setup inicial concluído", { userId: r.lastInsertRowid, email });
  res.json(
    await startSession(req, {
      id: r.lastInsertRowid,
      name,
      email,
      role: "admin",
    }),
  );
};
exports.login = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!u || !(await bcrypt.compare(req.body.password || "", u.password)))
  {
    logger.warn("falha de login", { email });
    return res.status(401).json({ error: "E-mail ou senha inválidos" });
  }
  logger.info("login realizado", { userId: u.id, email: u.email });
  res.json(
    await startSession(req, {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    }),
  );
};
exports.logout = (req, res) =>
  req.session.destroy(() => {
    logger.info("logout realizado");
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
