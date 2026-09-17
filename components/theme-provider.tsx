"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

export function ThemeProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      themes={["light", "dark"]}
    >
      {children}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  );
}
