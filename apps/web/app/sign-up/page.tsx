import { AuthForm } from "@/components/auth/AuthForm";
import { redirectIfAuthenticated } from "@/lib/page-auth";

interface SignUpPageProps {
  searchParams: Promise<{ callbackURL?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams;
  await redirectIfAuthenticated(params.callbackURL || "/admin/projects");
  return <AuthForm mode="sign-up" />;
}
