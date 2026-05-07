import mysql from "mysql2/promise";

export interface DorisConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
}

export function getDorisConfig(env = process.env): DorisConfig {
  return {
    host: env.DORIS_HOST ?? "127.0.0.1",
    port: Number(env.DORIS_PORT ?? 9030),
    user: env.DORIS_USER ?? "root",
    password: env.DORIS_PASSWORD,
    database: env.DORIS_DATABASE ?? "ask_ai",
  };
}

export function createDorisPool(config = getDorisConfig()) {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
  });
}

export type DorisPool = ReturnType<typeof createDorisPool>;

export function assertSqlIdentifier(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return identifier;
}

export function vectorLiteral(vector: number[]) {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}
