import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Attio Tasks Calendar",
  description: "Projects Attio tasks onto a dedicated Google calendar",
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
