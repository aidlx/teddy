import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Teddy',
  description: 'Teddy — AI product',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
