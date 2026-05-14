import { AskPanel } from "../../components/ask/AskPanel";

export default function AskPage() {
  const embedSnippet = `<script
  src="https://your-ask-ai-domain.com/embed.js"
  data-project-id="PROJECT_ID"
  data-title="Apache Doris AI"
  data-button-label="Ask AI"
  data-primary-color="#087f5b"
  async
></script>`;

  return (
    <main className="min-h-screen p-3">
      <AskPanel />
    </main>
  );
}
