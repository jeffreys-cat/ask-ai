import { ensureInitUser, getAuth } from "@selectdb/auth";

async function handler(request: Request) {
  await ensureInitUser();
  return getAuth().handler(request);
}

export const GET = handler;
export const POST = handler;
