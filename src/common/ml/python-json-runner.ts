import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export class PythonBridgeError extends Error {
  constructor(
    message: string,
    readonly details?: {
      scriptPath?: string;
      command?: string;
      stderr?: string;
      stdout?: string;
    },
  ) {
    super(message);
    this.name = 'PythonBridgeError';
  }
}

type PythonJsonRunnerOptions = {
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;

function resolvePythonExecutable() {
  return process.env.PYTHON_EXECUTABLE?.trim() || 'python';
}

function resolvePythonScript(scriptPath: string) {
  if (isAbsolute(scriptPath) && existsSync(scriptPath)) {
    return scriptPath;
  }

  const candidates = [
    resolve(process.cwd(), scriptPath),
    resolve(__dirname, '../../../', scriptPath),
    resolve(__dirname, '../../../../', scriptPath),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function pythonModelAvailable(scriptPath: string) {
  return existsSync(resolvePythonScript(scriptPath));
}

export function runPythonJsonSync<TOutput>(
  scriptPath: string,
  command: string,
  input: unknown,
  options: PythonJsonRunnerOptions = {},
): TOutput {
  const resolvedScriptPath = resolvePythonScript(scriptPath);
  const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    input: `${JSON.stringify(input ?? {})}\n`,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
  };
  const result = spawnSync(
    resolvePythonExecutable(),
    [resolvedScriptPath, command],
    spawnOptions,
  );

  if (result.error) {
    throw new PythonBridgeError(
      `No se pudo ejecutar Python para ${command}: ${result.error.message}`,
      {
        scriptPath: resolvedScriptPath,
        command,
        stderr: result.stderr?.trim(),
        stdout: result.stdout?.trim(),
      },
    );
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || 'sin detalle';
    throw new PythonBridgeError(
      `Python devolvio error al ejecutar ${command}: ${stderr}`,
      {
        scriptPath: resolvedScriptPath,
        command,
        stderr,
        stdout: result.stdout?.trim(),
      },
    );
  }

  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new PythonBridgeError(
      `Python no devolvio salida JSON para ${command}.`,
      {
        scriptPath: resolvedScriptPath,
        command,
        stderr: result.stderr?.trim(),
        stdout,
      },
    );
  }

  try {
    return JSON.parse(stdout) as TOutput;
  } catch (error) {
    throw new PythonBridgeError(
      `La salida de Python para ${command} no fue JSON valido.`,
      {
        scriptPath: resolvedScriptPath,
        command,
        stderr: result.stderr?.trim(),
        stdout,
      },
    );
  }
}
