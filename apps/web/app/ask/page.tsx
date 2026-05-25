import { AskPanel } from "../../components/ask/AskPanel";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { requirePageSession } from "@/lib/page-auth";

export default async function AskPage() {
  await requirePageSession("/ask");

  return (
    <main className="flex h-screen flex-col overflow-hidden p-3">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3 px-1">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ask AI</h1>
          <p className="text-sm text-muted-foreground">Search organization-scoped project documents.</p>
        </div>
        <SignOutButton />
      </header>
      <AskPanel className="min-h-0 flex-1" />
    </main>
  );
}
