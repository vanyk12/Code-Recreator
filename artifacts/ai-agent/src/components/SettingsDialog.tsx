import { useState, useEffect } from "react";
import { X, Key, Cpu, Eye, EyeOff, Save, CheckCircle } from "lucide-react";

interface Settings {
  openrouterKey: string;
  defaultModel: string;
  imageModel: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  activeChatId?: number | null;
  onModelSaved?: (model: string) => void;
}

export function SettingsDialog({ open, onClose, activeChatId, onModelSaved }: Props) {
  const [settings, setSettings] = useState<Settings>({ openrouterKey: "", defaultModel: "anthropic/claude-3.5-sonnet", imageModel: "openai/dall-e-3" });
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [keyStored, setKeyStored] = useState(false);

  useEffect(() => {
    if (open) {
      fetch("/api/settings")
        .then(r => r.json())
        .then((data: Record<string, string>) => {
          const stored = data.openrouter_key === "***stored***";
          setKeyStored(stored);
          setSettings({
            openrouterKey: stored ? "" : (data.openrouter_key || ""),
            defaultModel: data.default_model || "anthropic/claude-3.5-sonnet",
            imageModel: data.image_model || "openai/dall-e-3",
          });
        })
        .catch(() => {});
    }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = { default_model: settings.defaultModel };
      if (settings.openrouterKey.trim()) {
        body.openrouter_key = settings.openrouterKey.trim();
      }
      if (settings.imageModel.trim()) {
        body.image_model = settings.imageModel.trim();
      }
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (activeChatId) {
        await fetch(`/api/chats/${activeChatId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: settings.defaultModel }),
        });
      }

      onModelSaved?.(settings.defaultModel);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg mx-4">
        <div className="settings-card rounded-2xl overflow-hidden shadow-2xl">

          <div className="settings-header relative p-6 pb-4 overflow-hidden">
            <div className="shimmer-bg absolute inset-0" />
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img src="/synapse-icon.webp" alt="Synapse" className="w-8 h-8 rounded-lg" />
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Настройки</h2>
                  <p className="text-xs text-white/60">SYNAPSE AGENT</p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors" data-testid="button-close-settings">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="settings-body p-5 space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Key size={14} className="text-primary" />
                Токен OpenRouter API
              </label>
              <p className="text-xs text-muted-foreground">
                Получи ключ на{" "}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-accent underline hover:text-accent/80">
                  openrouter.ai/keys
                </a>
              </p>
              {keyStored && !settings.openrouterKey && (
                <p className="text-xs text-green-400/70 flex items-center gap-1">
                  ✓ Токен уже сохранён — оставь пустым чтобы не менять
                </p>
              )}
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={settings.openrouterKey}
                  onChange={e => { setSettings(s => ({ ...s, openrouterKey: e.target.value })); setKeyStored(false); }}
                  placeholder={keyStored && !settings.openrouterKey ? "● ● ● сохранён ● ● ●" : "sk-or-v1-..."}
                  className="w-full bg-input border border-border rounded-xl px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono"
                  data-testid="input-openrouter-key"
                />
                <button type="button" onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Cpu size={14} className="text-accent" />
                Модель по умолчанию
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={settings.defaultModel}
                  onChange={e => setSettings(s => ({ ...s, defaultModel: e.target.value }))}
                  placeholder="anthropic/claude-3.5-sonnet"
                  className="flex-1 min-w-0 bg-input border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent font-mono"
                  data-testid="input-default-model"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["claude-3.5-sonnet", "anthropic/claude-3.5-sonnet"],
                  ["gpt-4o", "openai/gpt-4o"],
                  ["gemini-2.0-flash", "google/gemini-2.0-flash-001"],
                  ["deepseek-r1", "deepseek/deepseek-r1"],
                ].map(([label, m]) => (
                  <button key={m} onClick={() => setSettings(s => ({ ...s, defaultModel: m as string }))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors border ${
                      settings.defaultModel === m
                        ? "bg-primary/20 border-primary/40 text-primary"
                        : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Cpu size={14} className="text-purple-400" />
                Модель генерации картинок
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={settings.imageModel}
                  onChange={e => setSettings(s => ({ ...s, imageModel: e.target.value }))}
                  placeholder="openai/dall-e-3"
                  className="flex-1 min-w-0 bg-input border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-400 focus:border-purple-400 font-mono"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["dall-e-3", "openai/dall-e-3"],
                  ["dall-e-3-hd", "openai/dall-e-3-hd"],
                  ["stable-diffusion-xl", "stabilityai/stable-diffusion-xl-1024-v1-0"],
                ].map(([label, m]) => (
                  <button key={m} onClick={() => setSettings(s => ({ ...s, imageModel: m as string }))}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors border ${
                      settings.imageModel === m
                        ? "bg-purple-500/20 border-purple-400/40 text-purple-300"
                        : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-1">
              <button onClick={handleSave} disabled={saving}
                className="save-btn w-full relative overflow-hidden flex items-center justify-center gap-2 py-2 px-4 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-70"
                data-testid="button-save-settings">
                <div className="shimmer-btn-bg absolute inset-0" />
                <span className="relative z-10 flex items-center gap-2">
                  {saved ? <><CheckCircle size={16} /> Сохранено!</>
                    : saving ? <><Save size={16} className="animate-spin" /> Сохраняем...</>
                    : <><Save size={16} /> Сохранить настройки</>}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .settings-card { background: hsl(220 40% 11%); border: 1px solid hsl(220 30% 22%); }
        .shimmer-bg {
          background: linear-gradient(135deg, hsl(25 95% 35% / 0.9) 0%, hsl(213 94% 45% / 0.9) 40%, hsl(25 95% 45% / 0.8) 70%, hsl(213 94% 35% / 0.9) 100%);
          animation: shimmer-shift 4s ease-in-out infinite alternate;
          background-size: 200% 200%;
        }
        .shimmer-btn-bg {
          background: linear-gradient(135deg, hsl(25 95% 48%) 0%, hsl(213 94% 55%) 50%, hsl(25 95% 40%) 100%);
          background-size: 200% 200%;
          animation: shimmer-shift 2s ease-in-out infinite alternate;
        }
        @keyframes shimmer-shift { 0% { background-position: 0% 0%; } 100% { background-position: 100% 100%; } }
        .scrollbar-thin::-webkit-scrollbar { width: 5px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: hsl(220 30% 30%); border-radius: 10px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: hsl(220 30% 40%); }
      `}</style>
    </div>
  );
}
