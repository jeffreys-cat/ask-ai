import { auth, ensureInitUser } from "@selectdb/auth";

async function handler(request: Request) {
  await ensureInitUser();
  return auth.handler(request);
}

export const GET = handler;
export const POST = handler;
