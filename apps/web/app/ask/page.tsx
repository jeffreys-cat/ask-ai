import { AskPanel } from "../../components/ask/AskPanel";

export default function AskPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Ask AI</h1>
          <p className="mt-2 text-sm text-muted-foreground">Ask questions against an indexed documentation project and inspect cited source chunks.</p>
        </div>
        <a className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground" href="/admin/projects">Projects</a>
      </section>
      <AskPanel />
    </main>
  );
}
