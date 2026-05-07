export function createSaveFeedbackTool(save: (input: { rating: "up" | "down"; comment?: string }) => Promise<void>) {
  return {
    id: "save-feedback",
    description: "Persist user feedback for an answer.",
    execute: save,
  };
}
