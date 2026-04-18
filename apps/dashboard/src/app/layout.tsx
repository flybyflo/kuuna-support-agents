import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kuuna Dashboard",
  description: "Staff dashboard for WhatsApp group agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
