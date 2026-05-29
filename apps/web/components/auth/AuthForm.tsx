"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Github, Loader2, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackURL = searchParams.get("callbackURL") || "/admin/projects";
  const isSignUp = mode === "sign-up";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<"email" | "github" | "google" | null>(null);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPendingAction("email");

    const result = isSignUp
      ? await authClient.signUp.email({
          name: name.trim() || email.trim(),
          email: email.trim(),
          password,
          callbackURL,
        })
      : await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL,
        });

    setPendingAction(null);
    if (result.error) {
      setError(result.error.message || "Authentication failed");
      return;
    }

    router.push(callbackURL);
    router.refresh();
  }

  async function signInWithProvider(provider: "github" | "google") {
    setError("");
    setPendingAction(provider);
    const result = await authClient.signIn.social({ provider, callbackURL });
    setPendingAction(null);
    if (result.error) setError(result.error.message || `Unable to continue with ${provider}`);
  }

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#fffaf0_0%,#f8fafc_42%,#eff6ff_100%)] px-4 py-10">
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(120deg,rgba(234,88,12,0.14)_0%,transparent_34%),linear-gradient(240deg,rgba(14,165,233,0.14)_0%,transparent_36%),linear-gradient(160deg,rgba(15,23,42,0.06),transparent_44%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.045)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,rgba(0,0,0,0.7),transparent_82%)]" />
      <div className="absolute -left-40 bottom-16 -z-10 h-52 w-[42rem] -rotate-12 border-y border-primary/10 bg-primary/5" />
      <div className="absolute -right-36 top-20 -z-10 h-48 w-[40rem] rotate-12 border-y border-sky-200/70 bg-sky-100/30" />

      <Card className="w-full max-w-md border-white/65 bg-background/90 shadow-2xl shadow-slate-900/10 backdrop-blur-xl">
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LockKeyhole className="size-5" />
          </div>
          <CardTitle>{isSignUp ? "Create your account" : "Sign in to Ask AI"}</CardTitle>
          <CardDescription>
            {isSignUp ? "Use email and password, GitHub, or Google to get started." : "Use your email, GitHub, or Google account to continue."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Authentication failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Button type="button" variant="outline" className="w-full" onClick={() => signInWithProvider("github")} disabled={Boolean(pendingAction)}>
              {pendingAction === "github" ? <Loader2 className="animate-spin" /> : <Github />}
              Continue with GitHub
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>

          <form className="grid gap-4" onSubmit={submitEmail}>
            {isSignUp ? (
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ada Lovelace" />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" disabled={Boolean(pendingAction)}>
              {pendingAction === "email" ? <Loader2 className="animate-spin" /> : <Mail />}
              {isSignUp ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
            <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`${isSignUp ? "/sign-in" : "/sign-up"}?callbackURL=${encodeURIComponent(callbackURL)}`}>
              {isSignUp ? "Sign in" : "Create one"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
