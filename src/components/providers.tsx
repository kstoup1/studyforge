"use client";

import type { ReactNode } from "react";
import { TimeZoneCookie } from "@/components/time-zone-cookie";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      <TimeZoneCookie />
      {children}
    </>
  );
}
