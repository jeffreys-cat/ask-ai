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
    <main className="h-screen overflow-hidden p-3">
      <AskPanel className="h-full min-h-0" />
    </main>
  );
}
