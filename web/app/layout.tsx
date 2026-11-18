import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Codeplus", template: "%s · Codeplus" },
  description: "Solve programming problems in C, C++ and Python, judged in a Linux-native sandbox.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            code<span>+</span>
          </Link>
          <nav>
            <Link href="/">Problems</Link>
            <Link href="/admin">Upload</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
