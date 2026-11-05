import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Milestone Grants",
  description: "Fund builders milestone by milestone on Portaldot, with git-commit evidence and reviewer approval.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
