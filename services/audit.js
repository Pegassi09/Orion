/** Grava eventos relevantes do inventário para auditoria administrativa. */
const db = require("../database/schema");
module.exports = (user, action, entity, id, details = "") =>
  db
    .prepare(
      "INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)",
    )
    .run(user?.id || null, action, entity, id, details);
