import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CalendarAutoSync } from '@/components/CalendarAutoSync';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Teddy',
  description: 'Your study assistant.',
};

const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased selection:bg-amber-400/40 selection:text-amber-950 dark:bg-zinc-950 dark:text-zinc-100 dark:selection:bg-amber-400/30 dark:selection:text-amber-100">
        <ThemeToggle />
        <CalendarAutoSync />
        {children}
      </body>
    </html>
  );
}
