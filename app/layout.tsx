import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Connector Hub", description: "FIC + Float planning dashboard" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="it"><body>{children}</body></html>;
}
