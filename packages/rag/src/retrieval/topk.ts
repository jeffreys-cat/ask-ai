const MIN_TOPK = 1;
const MAX_TOPK = 50;
const DEFAULT_TOPK = 3;

export { DEFAULT_TOPK, MAX_TOPK, MIN_TOPK };

export function normalizeTopK(topK: number | undefined, env: NodeJS.ProcessEnv = process.env) {
  return topK === undefined || !Number.isFinite(topK) ? defaultTopKFromEnv(env) : clampTopK(topK);
}

export function defaultTopKFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number(env.TOPK);
  if (!Number.isFinite(configured)) return DEFAULT_TOPK;
  return clampTopK(configured);
}

function clampTopK(topK: number) {
  return Math.min(Math.max(Math.trunc(topK), MIN_TOPK), MAX_TOPK);
}
