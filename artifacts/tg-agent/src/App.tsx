import { useEffect } from "react";
import { useTelegram } from "./hooks/useTelegram";
import { setInitData } from "./lib/api";
import ChatPage from "./pages/Chat";

function OpenInTelegram() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-6">
      <div className="text-5xl">✈️</div>
      <div>
        <div className="font-bold text-xl mb-2">SYNAPSE AGENT</div>
        <div className="text-sm opacity-60 leading-relaxed">
          Это Telegram Mini App.<br />
          Откройте его через бота в Telegram.
        </div>
      </div>
      <a
        href="https://t.me/"
        className="px-6 py-3 rounded-2xl text-sm font-semibold"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        Открыть Telegram
      </a>
    </div>
  );
}

export default function App() {
  const { initData, colorScheme, ready } = useTelegram();
  const isInTelegram = !!window.Telegram?.WebApp?.initData;

  useEffect(() => {
    setInitData(initData);
  }, [initData]);

  useEffect(() => {
    if (colorScheme === "light") {
      document.documentElement.classList.remove("dark-tg");
    } else {
      document.documentElement.classList.add("dark-tg");
    }
  }, [colorScheme]);

  if (!ready) return null;
  if (!isInTelegram) return <OpenInTelegram />;
  return <ChatPage />;
}
