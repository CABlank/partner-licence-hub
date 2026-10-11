import './globals.css';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata = {
  title: 'Partner Licence Hub',
  description: 'Independent prototype by Carlos Blank. Fictional data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
