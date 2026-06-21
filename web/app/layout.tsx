import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Sponsorship HUD",
  description:
    "Live, animated control room for the RL agent allocating sponsorship dollars across the US.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
