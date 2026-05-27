import { AskPanel } from "../../components/ask/AskPanel";
import { AppShell } from "@/components/app/AppShell";
import { requirePageSession } from "@/lib/page-auth";

export default async function AskPage() {
  const session = await requirePageSession("/ask");

  return (
    <AppShell user={session.user}>
      <main className="flex h-screen flex-col overflow-hidden p-3">
        <header className="mb-3 flex shrink-0 items-center justify-between gap-3 px-1">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Ask AI</h1>
            <p className="text-sm text-muted-foreground">Search organization-scoped project documents.</p>
          </div>
        </header>
        <AskPanel className="min-h-0 flex-1" />
      </main>
    </AppShell>
  );
}
