import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask AI",
  description: "Organization-scoped document Q&A",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
