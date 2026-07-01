
import { useState, useRef } from "react";
import { useListFiles, useCreateFile, useDeleteFile, useImportZip, useImportGithub } from "../hooks/use-files";
import { toast } from "sonner";

interface FileExplorerProps {
  chatId: number | null;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: Map<string, TreeNode>;
  fileId?: number;
  content?: string;
}

function buildTree(files: Array<{ id: number; path: string; content: string }>): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", isDir: true, children: new Map() };
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          isDir: !isLast,
          children: new Map(),
        });
      }
      const node = current.children.get(part)!;
      if (isLast) {
        node.isDir = false;
        node.fileId = f.id;
        node.content = f.content;
      }
      current = node;
    }
  }
  return root;
}

export function FileExplorer({ chatId }: FileExplorerProps) {
  const { data: files = [], isLoading } = useListFiles(chatId);
  const createFile = useCreateFile();
  const deleteFile = useDeleteFile();
  const importZip = useImportZip();
  const importGithub = useImportGithub();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{ id: number; path: string; content: string } | null>(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [showGithubDialog, setShowGithubDialog] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [newFileContent, setNewFileContent] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tree = buildTree(files);
  const fileCount = files.length;

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleCreateFile = async () => {
    if (!chatId || !newFilePath.trim()) return;
    try {
      await createFile.mutateAsync({
        chatId,
        path: newFilePath.trim(),
        content: newFileContent,
      });
      toast.success(`Файл "${newFilePath.trim()}" создан`);
      setShowNewFileDialog(false);
      setNewFilePath("");
      setNewFileContent("");
    } catch (e: any) {
      toast.error(e.message || "Ошибка создания файла");
    }
  };

  const handleDeleteFile = async (id: number, path: string) => {
    if (!chatId) return;
    if (!confirm(`Удалить файл "${path}"?`)) return;
    try {
      await deleteFile.mutateAsync({ id, chatId });
      toast.success(`Файл "${path}" удалён`);
      if (selectedFile?.id === id) setSelectedFile(null);
    } catch (e: any) {
      toast.error(e.message || "Ошибка удаления");
    }
  };

  const handleZipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;
    try {
      const buffer = await file.arrayBuffer();
      const result = await importZip.mutateAsync({ chatId, zipBuffer: buffer });
      toast.success(`Импортировано ${result.imported} файлов из ZIP`);
    } catch (e: any) {
      toast.error(e.message || "Ошибка импорта ZIP");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleGithubImport = async () => {
    if (!chatId || !githubUrl.trim()) return;
    try {
      const result = await importGithub.mutateAsync({ chatId, repoUrl: githubUrl.trim() });
      toast.success(`Импортировано ${result.imported} файлов из GitHub`);
      setShowGithubDialog(false);
      setGithubUrl("");
    } catch (e: any) {
      toast.error(e.message || "Ошибка импорта из GitHub");
    }
  };

  const renderNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const sortedChildren = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return sortedChildren.map((child) => {
      const isExpanded = expandedDirs.has(child.fullPath);
      if (child.isDir) {
        return (
          <div key={child.fullPath}>
            <div
              onClick={() => toggleDir(child.fullPath)}
              className="flex items-center gap-1 px-2 py-1 hover:bg-muted/50 cursor-pointer text-sm rounded-sm"
              style={{ paddingLeft: `${depth * 12 + 8}px` }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${isExpanded ? "" : "-rotate-90"} text-muted-foreground`}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="text-foreground/90">{child.name}</span>
            </div>
            {isExpanded && renderNode(child, depth + 1)}
          </div>
        );
      }
      const isSelected = selectedFile?.id === child.fileId;
      return (
        <div
          key={child.fullPath}
          className={`group flex items-center gap-1 px-2 py-1 cursor-pointer text-sm rounded-sm ${
            isSelected ? "bg-muted" : "hover:bg-muted/50"
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setSelectedFile({ id: child.fileId!, path: child.fullPath, content: child.content || "" })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="text-foreground/80 truncate flex-1">{child.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteFile(child.fileId!, child.fullPath); }}
            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-opacity p-0.5"
            title="Удалить"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      );
    });
  };

  if (!chatId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4 text-center">
        Выберите чат для работы с файлами
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 p-2 border-b border-border">
        <button
          onClick={() => setShowNewFileDialog(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
          title="Создать новый файл"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
          Новый файл
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 transition-colors"
          title="Импортировать ZIP архив"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          ZIP
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleZipUpload}
        />

        <button
          onClick={() => setShowGithubDialog(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 transition-colors"
          title="Импортировать из GitHub репозитория"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          GitHub
        </button>
      </div>

      {/* Loading state */}
      {(isLoading || createFile.isPending || importZip.isPending || importGithub.isPending) && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/30">
          <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          {importZip.isPending ? "Импорт ZIP..." : importGithub.isPending ? "Клонирование репозитория..." : "Загрузка..."}
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {fileCount === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/40 mb-3">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p className="text-sm text-muted-foreground mb-1">Нет файлов</p>
            <p className="text-xs text-muted-foreground/60">Создайте новый файл или импортируйте из ZIP / GitHub</p>
          </div>
        ) : (
          renderNode(tree)
        )}
      </div>

      {/* File preview */}
      {selectedFile && (
        <div className="border-t border-border max-h-[40%] flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
            <span className="text-xs font-medium text-foreground/80 truncate">{selectedFile.path}</span>
            <button
              onClick={() => setSelectedFile(null)}
              className="text-muted-foreground hover:text-foreground p-0.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="overflow-auto p-2 flex-1">
            <pre className="text-xs text-foreground/70 font-mono whitespace-pre-wrap break-all">
              {selectedFile.content || "[Пустой файл]"}
            </pre>
          </div>
        </div>
      )}

      {/* New File Dialog */}
      {showNewFileDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewFileDialog(false)}>
          <div className="bg-background border border-border rounded-lg p-5 w-[420px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Создать новый файл</h3>
            <input
              type="text"
              placeholder="src/main.ts"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              className="w-full px-3 py-2 mb-3 text-sm border border-border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
            />
            <textarea
              placeholder="Содержимое файла (необязательно)..."
              value={newFileContent}
              onChange={(e) => setNewFileContent(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              rows={6}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewFileDialog(false)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-muted text-muted-foreground"
              >
                Отмена
              </button>
              <button
                onClick={handleCreateFile}
                disabled={!newFilePath.trim() || createFile.isPending}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Import Dialog */}
      {showGithubDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowGithubDialog(false)}>
          <div className="bg-background border border-border rounded-lg p-5 w-[420px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1">Импорт из GitHub</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Введите URL репозитория. Будет выполнен shallow clone, файлы будут сохранены в чат.
            </p>
            <input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleGithubImport()}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowGithubDialog(false)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-muted text-muted-foreground"
              >
                Отмена
              </button>
              <button
                onClick={handleGithubImport}
                disabled={!githubUrl.trim() || importGithub.isPending}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {importGithub.isPending ? "Импорт..." : "Импортировать"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
