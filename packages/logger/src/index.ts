export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMeta = Record<string, unknown>;
export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
  sqlMessage?: unknown;
};

export interface Logger {
  debug(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  error(message: string, meta?: LogMeta): void;
  child(bindings: LogMeta): Logger;
}

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(bindings: LogMeta = {}): Logger {
  const minLevel = normalizeLogLevel(process.env.LOG_LEVEL);

  const write = (level: LogLevel, message: string, meta?: LogMeta) => {
    if (levelWeights[level] < levelWeights[minLevel]) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...serializeMeta(bindings),
      ...serializeMeta(meta ?? {}),
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const logger = createLogger();

export function serializeError(error: unknown): SerializedError | { message: string } {
  if (!(error instanceof Error)) return { message: String(error) };
  const extended = error as Error & { code?: unknown; errno?: unknown; sqlState?: unknown; sqlMessage?: unknown };
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause,
    code: extended.code,
    errno: extended.errno,
    sqlState: extended.sqlState,
    sqlMessage: extended.sqlMessage,
  };
}

function serializeMeta(meta: LogMeta) {
  return Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, value instanceof Error ? serializeError(value) : value]));
}

function normalizeLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") return value;
  return "info";
}
