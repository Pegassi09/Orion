/** Cifra de campo usando AES-256-GCM; nunca persiste senhas em texto puro. */
const crypto = require("crypto");
const key = crypto
  .createHash("sha256")
  .update(
    process.env.ENCRYPTION_KEY || "development-key-change-before-production",
  )
  .digest();
function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([c.update(String(value), "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}
function decrypt(value) {
  if (!value) return "";
  try {
    const [iv, tag, data] = value.split(":").map((x) => Buffer.from(x, "hex"));
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}
module.exports = { encrypt, decrypt };
