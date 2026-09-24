import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const service = process.argv[2];
const definitions = {
  server: {
    port: 5050,
    command: ["node_modules/nodemon/bin/nodemon.js", "server/src/index.js"]
  },
  client: {
    port: 5180,
    command: [
      "node_modules/vite/bin/vite.js",
      "--configLoader", "native",
      "--config", "client/vite.config.js",
      "--host", "0.0.0.0",
      "--port", "5180"
    ]
  }
};

const definition = definitions[service];
if (!definition) {
  console.error("Usage: node scripts/run-dev-service.mjs <server|client>");
  process.exit(1);
}

const runtimeDir = path.join(rootDir, ".dev-runtime");
const lockPath = path.join(runtimeDir, `${service}.lock`);

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function portIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      // Windows can report EACCES for a port reserved or owned by another session.
      // Treat both cases as unavailable and show the normal actionable message.
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function existingServiceIsRunning() {
  try {
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
    if (Number.isInteger(lock.pid) && isProcessRunning(lock.pid)) return true;
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Ignoring invalid ${service} dev lock.`);
  }
  await fs.rm(lockPath, { force: true });
  return false;
}

await fs.mkdir(runtimeDir, { recursive: true });

if (await existingServiceIsRunning()) {
  console.log(`${service} development service is already running; not starting a duplicate.`);
  process.exit(0);
}

if (!(await portIsAvailable(definition.port))) {
  console.error(
    `Cannot start ${service}: port ${definition.port} is already in use by a process outside this dev launcher. ` +
    `Stop that process, then run npm run ${service}:dev again.`
  );
  process.exit(1);
}

await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, service, startedAt: new Date().toISOString() }));
const [program, ...args] = definition.command;
const child = spawn(process.execPath, [program, ...args], { cwd: rootDir, stdio: "inherit" });

let cleaningUp = false;
async function cleanup(exitCode) {
  if (cleaningUp) return;
  cleaningUp = true;
  await fs.rm(lockPath, { force: true });
  process.exit(exitCode);
}

child.once("exit", (code) => cleanup(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill(signal);
    setTimeout(() => cleanup(1), 5000).unref();
  });
}
