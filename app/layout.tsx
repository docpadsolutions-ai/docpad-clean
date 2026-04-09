import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "../styles/themes.css";
import "./globals.css";
import { ThemeProviderWrapper } from "./theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DocPad",
  description: "Clinical workspace for hospital staff",
  icons: {
    icon: "/docpad-logo.png",
    apple: "/docpad-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /* No className on <html>: RSC updates can replace the whole attribute and strip `dark` from next-themes. */
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col bg-background text-foreground antialiased`}
      >
        <ThemeProviderWrapper>{children}</ThemeProviderWrapper>
      </body>
    </html>
  );
}
