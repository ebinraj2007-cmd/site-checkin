"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Alert } from "./ui";

type Message = { text: string; tone: "green" | "red" };
const FlashContext = createContext<(message: Message) => void>(() => {});

// A message at the top of the page that outlives the form that sent it (e.g. a review
// that disappears from the list once it's decided). Cleared on the next page.
export function FlashProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [flash, setFlash] = useState<(Message & { path: string }) | null>(null);
  const shown = flash?.path === pathname ? flash : null;
  return (
    <FlashContext.Provider value={(message) => setFlash({ ...message, path: pathname })}>
      <div aria-live="polite">{shown && <div className="mb-4"><Alert tone={shown.tone}>{shown.text}</Alert></div>}</div>
      {children}
    </FlashContext.Provider>
  );
}

export const useFlash = () => useContext(FlashContext);
