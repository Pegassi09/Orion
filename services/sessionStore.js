/** Store de sessão persistente em SQLite para não perder login ao reiniciar. */
const session = require("express-session");
const db = require("../database/schema");

class SqliteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db
        .prepare("SELECT data FROM sessions WHERE sid=? AND expires_at>?")
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sess, callback = () => {}) {
    try {
      const expires = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 8 * 60 * 60 * 1000;
      db.prepare(
        "INSERT INTO sessions(sid,data,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at",
      ).run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sess, callback = () => {}) {
    this.set(sid, sess, callback);
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = SqliteSessionStore;
