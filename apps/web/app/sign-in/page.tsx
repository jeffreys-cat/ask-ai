import { AuthForm } from "@/components/auth/AuthForm";
import { redirectIfAuthenticated } from "@/lib/page-auth";

interface SignInPageProps {
  searchParams: Promise<{ callbackURL?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  await redirectIfAuthenticated(params.callbackURL || "/ask");
  return <AuthForm mode="sign-in" />;
}
