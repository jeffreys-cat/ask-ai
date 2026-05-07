import { loadRootEnv } from "./load-env";

loadRootEnv();

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getEmbeddingDim() {
  const dim = Number(requiredEnv("EMBEDDING_DIM"));
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error("EMBEDDING_DIM must be a positive integer");
  }
  return dim;
}
