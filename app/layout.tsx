import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "../styles/themes.css";
import "./globals.css";
import { ThemeProviderWrapper } from "./theme-provider";
import { ToastProvider } from "@/src/components/ui/toast-provider";

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
        className={`${GeistSans.variable} ${GeistMono.variable} flex min-h-screen flex-col bg-background text-foreground antialiased`}
      >
        <ThemeProviderWrapper>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProviderWrapper>
      </body>
    </html>
  );
}
