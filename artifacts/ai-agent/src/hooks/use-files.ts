
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface FileItem {
  id: number;
  chatId: number;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = (import.meta as any).env?.VITE_API_URL || "";

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }
  const token = localStorage.getItem("auth_token");
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res;
}

export function useListFiles(chatId: number | null) {
  return useQuery({
    queryKey: ["files", chatId],
    queryFn: async () => {
      if (!chatId) return [];
      const res = await apiFetch(`/api/files/${chatId}`);
      return res.json() as Promise<FileItem[]>;
    },
    enabled: !!chatId,
    staleTime: 0,
  });
}

export function useCreateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { chatId: number; path: string; content?: string }) => {
      const res = await apiFetch(`/api/files`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["files", variables.chatId] });
    },
  });
}

export function useUpdateFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: number; content?: string; path?: string; chatId: number }) => {
      const res = await apiFetch(`/api/files/${data.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: data.content, path: data.path }),
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["files", variables.chatId] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: number; chatId: number }) => {
      const res = await apiFetch(`/api/files/${data.id}`, { method: "DELETE" });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["files", variables.chatId] });
    },
  });
}

export function useImportZip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { chatId: number; zipBuffer: ArrayBuffer }) => {
      const res = await apiFetch(`/api/files/import-zip/${data.chatId}`, {
        method: "POST",
        body: data.zipBuffer,
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["files", variables.chatId] });
    },
  });
}

export function useImportGithub() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { chatId: number; repoUrl: string }) => {
      const res = await apiFetch(`/api/files/import-github/${data.chatId}`, {
        method: "POST",
        body: JSON.stringify({ repoUrl: data.repoUrl }),
      });
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["files", variables.chatId] });
    },
  });
}
