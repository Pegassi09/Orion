/** Integração opcional do túnel Ngrok para ambientes com servidor persistente. */
const ngrok = require("@ngrok/ngrok");

let listener;
let shuttingDown = false;

function printDivider() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function errorReason(error) {
  return error?.message || "Erro desconhecido ao conectar ao Ngrok";
}

async function startNgrok(port) {
  if (!process.env.NGROK_AUTHTOKEN) {
    console.warn("⚠️ NGROK_AUTHTOKEN não configurado. O túnel não será iniciado.");
    return null;
  }

  const options = {
    addr: port,
    authtoken: process.env.NGROK_AUTHTOKEN,
    proto: "http",
    region: process.env.NGROK_REGION || "us",
  };
  if (process.env.NGROK_DOMAIN) options.domain = process.env.NGROK_DOMAIN;

  try {
    listener = await ngrok.forward(options);
    return listener.url();
  } catch (error) {
    printDivider();
    console.error("❌ Falha ao iniciar o túnel Ngrok");
    console.error(`Motivo: ${errorReason(error)}`);
    printDivider();
    return null;
  }
}

async function stopNgrok() {
  if (!listener) return;
  try {
    await ngrok.disconnect(listener.url());
  } catch (error) {
    console.error(`Erro ao encerrar o túnel Ngrok: ${errorReason(error)}`);
  } finally {
    listener = null;
  }
}

function registerShutdownHandlers(logger) {
  const shutdown = async (signal, exitCode) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopNgrok();
    if (signal) process.exit(exitCode);
  };

  process.once("SIGINT", () => shutdown("SIGINT", 0));
  process.once("SIGTERM", () => shutdown("SIGTERM", 0));
  process.once("uncaughtException", async (error) => {
    logger?.error("exceção não capturada", { error: error.message, stack: error.stack });
    console.error("Exceção não capturada:", error);
    await shutdown("uncaughtException", 1);
  });
  process.once("unhandledRejection", async (error) => {
    logger?.error("promise rejeitada sem tratamento", { error: error.message, stack: error.stack });
    console.error("Promise rejeitada sem tratamento:", error);
    await shutdown("unhandledRejection", 1);
  });
}

module.exports = { registerShutdownHandlers, startNgrok, stopNgrok };
