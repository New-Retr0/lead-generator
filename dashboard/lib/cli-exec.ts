import { spawn } from "child_process";
import { cliChildEnv } from "./env";
import { resolveCli } from "./paths";

export type CliExecResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export function runCli(args: string[], timeoutMs = 30_000): Promise<CliExecResult> {
  return new Promise((resolve, reject) => {
    const { command, baseArgs, cwd } = resolveCli();
    const child = spawn(command, [...baseArgs, ...args], {
      cwd,
      env: cliChildEnv(),
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
