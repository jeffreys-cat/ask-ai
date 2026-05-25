import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSession } from "./auth";

export async function requirePageSession(callbackURL = "/ask") {
  const session = await getAuthSession(await headers());
  if (!session?.user) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`);
  }
  return session;
}

export async function redirectIfAuthenticated(callbackURL = "/ask") {
  const session = await getAuthSession(await headers());
  if (session?.user) {
    redirect(callbackURL);
  }
}
