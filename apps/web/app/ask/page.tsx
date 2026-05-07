import { AskPanel } from "../../components/ask/AskPanel";

export default function AskPage() {
  return (
    <main className="ask-shell">
      <section className="ask-header">
        <div>
          <h1>Ask AI</h1>
          <p>Upload organization documents, ask questions, and inspect cited source chunks.</p>
        </div>
      </section>
      <AskPanel />
    </main>
  );
}
