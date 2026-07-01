
import { useState } from "react";
import { FileExplorer } from "./FileExplorer";
import { TerminalPanel } from "./TerminalPanel";
import { GitPanel } from "./GitPanel";

type Tab = "files" | "terminal" | "git";

interface RightPanelProps {
  chatId: number | null;
  fileRefreshKey?: number;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function RightPanel({ chatId, fileRefreshKey, collapsed, onToggle }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("files");
  const [internalCollapsed, setInternalCollapsed] = useState(false);

  const isCollapsed = collapsed ?? internalCollapsed;
  const toggle = onToggle ?? (() => setInternalCollapsed(!internalCollapsed));

  if (isCollapsed) {
    return (
      <div className="w-12 border-l border-border bg-background flex flex-col items-center py-3 gap-3 shrink-0">
        <button onClick={toggle} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Открыть панель">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button onClick={() => { toggle(); setActiveTab("files"); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Файлы">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
        </button>
        <button onClick={() => { toggle(); setActiveTab("terminal"); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Терминал">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
        </button>
        <button onClick={() => { toggle(); setActiveTab("git"); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Git">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-[380px] border-l border-border bg-background flex flex-col h-full overflow-hidden shrink-0">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <div className="flex gap-1">
          <TabButton active={activeTab === "files"} onClick={() => setActiveTab("files")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            <span className="ml-1.5 text-xs font-medium">Файлы</span>
          </TabButton>
          <TabButton active={activeTab === "terminal"} onClick={() => setActiveTab("terminal")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
            <span className="ml-1.5 text-xs font-medium">Терминал</span>
          </TabButton>
          <TabButton active={activeTab === "git"} onClick={() => setActiveTab("git")}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" /></svg>
            <span className="ml-1.5 text-xs font-medium">Git</span>
          </TabButton>
        </div>
        <button onClick={toggle} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Свернуть панель">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === "files" && <FileExplorer chatId={chatId} fileRefreshKey={fileRefreshKey} />}
        {activeTab === "terminal" && <TerminalPanel chatId={chatId} />}
        {activeTab === "git" && <GitPanel chatId={chatId} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center px-2.5 py-1.5 rounded-md transition-colors ${active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
      {children}
    </button>
  );
}
