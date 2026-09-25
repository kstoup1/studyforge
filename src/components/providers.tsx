"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { TimeZoneCookie } from "@/components/time-zone-cookie";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <TimeZoneCookie />
      {children}
    </SessionProvider>
  );
}
