import { useState, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { RightPanel } from "@/components/RightPanel";

export function Home() {
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);

  const handleFilesCreated = useCallback(() => {
    setFileRefreshKey(k => k + 1);
  }, []);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <Sidebar activeChatId={activeChatId} onSelectChat={setActiveChatId} />
      <ChatArea chatId={activeChatId} onFilesCreated={handleFilesCreated} />
      {activeChatId !== null && (
        <RightPanel chatId={activeChatId} fileRefreshKey={fileRefreshKey} />
      )}
    </div>
  );
}
