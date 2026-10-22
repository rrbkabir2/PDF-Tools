import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const processes = [
  spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    cwd: root,
    stdio: "inherit",
  }),
];
for (const child of processes)
  child.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
const stop = () => {
  for (const child of processes) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
