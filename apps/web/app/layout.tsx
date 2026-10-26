import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Chakra_Petch, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const display = Chakra_Petch({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'QUEUE//LAB · Load Control',
  description: 'Mission control for a BullMQ load-test pipeline.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-console text-grid-100 antialiased">
        {children}
      </body>
    </html>
  );
}
