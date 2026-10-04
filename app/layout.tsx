import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retrieval Recovery Copilot",
  description: "Recover a vaguely remembered photo without guessing search queries.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
