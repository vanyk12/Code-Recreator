import { useEffect, useState } from "react";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Telegram?: { WebApp: any };
  }
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export function useTelegram() {
  const tg = window.Telegram?.WebApp;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tg) { setReady(true); return; }
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.(tg.themeParams?.bg_color || "#1c1c1e");
    tg.setBackgroundColor?.(tg.themeParams?.bg_color || "#1c1c1e");
    setReady(true);
  }, [tg]);

  const user: TelegramUser | null = tg?.initDataUnsafe?.user ?? null;
  const initData: string = tg?.initData ?? "";
  const colorScheme: "dark" | "light" = tg?.colorScheme ?? "dark";

  return { tg, user, initData, colorScheme, ready };
}

export function getDisplayName(user: TelegramUser | null): string {
  if (!user) return "Гость";
  return [user.first_name, user.last_name].filter(Boolean).join(" ");
}
