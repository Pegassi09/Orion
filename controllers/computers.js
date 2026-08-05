/** Controlador de computadores: valida, persiste e consulta ativos. */
const db = require("../database/schema");
const { encrypt, decrypt } = require("../services/crypto");
const audit = require("../services/audit");
const logger = require("../services/logger");
// Lista permitida de campos do formulário simplificado.
const fields = [
  "hostname",
  "department",
  "location",
  "responsible",
  "proprietary",
  "brand",
  "model",
  "serial_number",
  "processor",
  "ram_gb",
  "ram_type",
  "storage_type",
  "storage_capacity",
  "operating_system",
  "windows_version",
  "windows_build",
  "ip_address",
  "computer_password",
];
const exportFields = fields.filter((field) => field !== "computer_password");
const required = [
  "hostname",
  "department",
  "location",
  "responsible",
  "brand",
  "model",
  "serial_number",
  "processor",
  "ram_gb",
  "storage_type",
  "storage_capacity",
  "operating_system",
];

const textLimits = {
  hostname: 120,
  department: 120,
  location: 160,
  responsible: 120,
  proprietary: 120,
  brand: 80,
  model: 120,
  serial_number: 160,
  processor: 160,
  ram_type: 20,
  storage_type: 30,
  storage_capacity: 40,
  operating_system: 100,
  windows_version: 80,
  windows_build: 60,
  ip_address: 64,
  computer_password: 512,
};

const validIpOrCidr =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$/;
const validMacAddress = /^(?:[\da-f]{2}[:-]){5}[\da-f]{2}$/i;

function toPositiveInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function idFrom(req) {
  const id = Number.parseInt(req.params.id, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Valida os requisitos mínimos antes de qualquer escrita no banco.
function valid(body) {
  const missing = required.filter(
    (k) => body[k] === undefined || body[k] === null || body[k] === "",
  );
  if (missing.length) {
    return `Preencha os campos obrigatórios: ${missing.join(", ")}`;
  }
  for (const [field, limit] of Object.entries(textLimits)) {
    if (body[field] && String(body[field]).length > limit) {
      return `O campo ${field} ultrapassa o limite de ${limit} caracteres`;
    }
  }
  const ram = Number.parseInt(body.ram_gb, 10);
  if (!Number.isSafeInteger(ram) || ram < 1 || ram > 2048) {
    return "Informe uma quantidade de RAM válida entre 1 e 2048 GB";
  }
  const capacity = Number.parseFloat(
    String(body.storage_capacity).replace(",", "."),
  );
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return "Informe uma capacidade de armazenamento válida";
  }
  if (
    body.ip_address &&
    !validIpOrCidr.test(body.ip_address) &&
    !validMacAddress.test(body.ip_address)
  ) {
    return "Informe um endereço IP ou MAC válido";
  }
  if (body.ram_type && !["DDR3", "DDR4", "DDR5"].includes(body.ram_type)) {
    return "Tipo de memória inválido";
  }
  if (!["HD", "SSD SATA", "SSD NVMe"].includes(body.storage_type)) {
    return "Tipo de armazenamento inválido";
  }
  return null;
}
// Normaliza dados e cifra os únicos campos confidenciais.
function data(body) {
  let o = {};
  fields.forEach((k) => (o[k] = body[k] === "" ? null : (body[k] ?? null)));
  o.ram_gb = Number.parseInt(body.ram_gb, 10);
  o.computer_password = encrypt(body.computer_password);
  return o;
}
// Listagem paginada, pesquisável e com ordenação restrita a colunas seguras.
exports.list = (req, res) => {
  const {
    q = "",
    department = "",
    brand = "",
    os = "",
    page = 1,
    limit = 10,
    sort = "updated_at",
    order = "DESC",
  } = req.query;
  const allowed = [
    "hostname",
    "department",
    "responsible",
    "operating_system",
    "processor",
    "ram_gb",
    "storage_capacity",
    "ip_address",
    "updated_at",
  ];
  const col = allowed.includes(sort) ? sort : "updated_at";
  const currentPage = toPositiveInteger(page, 1, 1, 999999);
  const pageSize = toPositiveInteger(limit, 10, 1, 100);
  let where = [],
    p = [];
  if (q) {
    where.push(
      "(hostname LIKE ? OR location LIKE ? OR responsible LIKE ? OR serial_number LIKE ?)",
    );
    p.push(...Array(4).fill(`%${q}%`));
  }
  for (const [k, v] of Object.entries({
    department,
    brand,
    operating_system: os,
  })) {
    if (v) {
      where.push(`${k}=?`);
      p.push(v);
    }
  }
  const clause = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = db
    .prepare(`SELECT count(*) total FROM computers ${clause}`)
    .get(...p).total;
  const rows = db
    .prepare(
      `SELECT id,hostname,department,location,responsible,proprietary,brand,model,serial_number,operating_system,windows_version,windows_build,processor,ram_gb,ram_type,storage_type,storage_capacity,ip_address,updated_at FROM computers ${clause} ORDER BY ${col} ${order === "ASC" ? "ASC" : "DESC"} LIMIT ? OFFSET ?`,
    )
    .all(...p, pageSize, (currentPage - 1) * pageSize);
  res.json({
    rows,
    total,
    page: currentPage,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  });
};
// Detalhe de ativo; senhas só são decifradas mediante solicitação explícita.
exports.get = (req, res) => {
  const id = idFrom(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const row = db.prepare("SELECT * FROM computers WHERE id=?").get(id);
  if (!row) return res.status(404).json({ error: "Computador não encontrado" });
  if (req.query.reveal === "true") {
    row.computer_password = decrypt(row.computer_password);
  } else {
    row.computer_password = row.computer_password ? "••••••••" : "";
  }
  res.json(row);
};
// Operações de escrita também registram auditoria para rastreabilidade.
exports.create = (req, res) => {
  const e = valid(req.body);
  if (e) return res.status(422).json({ error: e });
  try {
    const d = data(req.body),
      keys = Object.keys(d);
    const r = db
      .prepare(
        `INSERT INTO computers(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
      )
      .run(...keys.map((k) => d[k]));
    audit(
      req.session.user,
      "CREATE",
      "computer",
      r.lastInsertRowid,
      d.hostname,
    );
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({
      error: e.message.includes("UNIQUE")
        ? "Registro já cadastrado"
        : "Não foi possível salvar o computador",
    });
  }
};
exports.update = (req, res) => {
  const id = idFrom(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const e = valid(req.body);
  if (e) return res.status(422).json({ error: e });
  try {
    const d = data(req.body);
    if (!req.body.computer_password) delete d.computer_password;
    const keys = Object.keys(d);
    db.prepare(
      `UPDATE computers SET ${keys.map((k) => `${k}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(...keys.map((k) => d[k]), id);
    const exists = db.prepare("SELECT changes() affected").get().affected;
    if (!exists)
      return res.status(404).json({ error: "Computador não encontrado" });
    audit(req.session.user, "UPDATE", "computer", id, d.hostname);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: "Não foi possível atualizar o computador" });
  }
};
exports.remove = (req, res) => {
  const id = idFrom(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const result = db.prepare("DELETE FROM computers WHERE id=?").run(id);
  if (!result.changes)
    return res.status(404).json({ error: "Computador não encontrado" });
  audit(req.session.user, "DELETE", "computer", id);
  res.json({ ok: true });
};
exports.duplicate = (req, res) => {
  const id = idFrom(req);
  if (!id) return res.status(400).json({ error: "ID inválido" });
  const c = db.prepare("SELECT * FROM computers WHERE id=?").get(id);
  if (!c) return res.status(404).json({ error: "Não encontrado" });
  delete c.id;
  delete c.created_at;
  delete c.updated_at;
  c.hostname += " - Cópia";
  const copy = Object.fromEntries(
    fields.map((field) => [field, c[field] ?? null]),
  );
  const keys = Object.keys(copy);
  const r = db
    .prepare(
      `INSERT INTO computers(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
    )
    .run(...keys.map((k) => copy[k]));
  audit(
    req.session.user,
    "DUPLICATE",
    "computer",
    r.lastInsertRowid,
    c.hostname,
  );
  res.status(201).json({ id: r.lastInsertRowid });
};
exports.stats = (req, res) => {
  const group = (col) =>
    db
      .prepare(
        `SELECT ${col} label,count(*) value FROM computers GROUP BY ${col} ORDER BY value DESC`,
      )
      .all();
  res.json({
    total: db.prepare("SELECT count(*) v FROM computers").get().v,
    department: group("department"),
    operating_system: group("operating_system"),
    brand: group("brand"),
    ram: group("ram_gb"),
    storage: group("storage_type"),
  });
};
// Nunca exporta campos confidenciais, mesmo que estejam cifrados no banco.
exports.all = () =>
  db
    .prepare(
      `SELECT ${exportFields.join(",")} FROM computers ORDER BY hostname`,
    )
    .all();
exports.fields = exportFields;
