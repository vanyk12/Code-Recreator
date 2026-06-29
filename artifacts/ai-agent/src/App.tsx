import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/Home";
import { SignInPage } from "@/pages/SignInPage";
import { useState, useEffect, createContext, useContext, useRef } from "react";
import { initSupabase, getSupabaseState } from "@/lib/supabase";
import { AUTH_ENABLED, setAuthEnabled } from "@/lib/auth";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import type { User, Session, SupabaseClient } from "@supabase/supabase-js";

const queryClient = new QueryClient();

type Theme = "dark" | "light";
interface ThemeCtx { theme: Theme; toggle: () => void }
export const ThemeContext = createContext<ThemeCtx>({ theme: "dark", toggle: () => {} });
export function useTheme() { return useContext(ThemeContext); }

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Auth context ────────────────────────────────────────────────────
interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}
export const AuthContext = createContext<AuthCtx>({
  user: null, session: null, loading: true,
  signOut: async () => {},
});
export function useAuth() { return useContext(AuthContext); }

export { type User, type Session };

// ─── Router ───────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

// ─── Loading screen ──────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center"
      style={{ background: "hsl(222 47% 8%)" }}
    >
      <div className="flex flex-col items-center gap-4">
        <img
          src="/synapse-icon.webp"
          alt="SYNAPSE"
          className="w-14 h-14 rounded-2xl animate-pulse"
        />
        <span className="text-sm text-white/40 tracking-widest uppercase">
          Загрузка...
        </span>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("synapse-theme") as Theme) || "dark";
  });

  // ── Runtime config loading state ──
  const [configLoaded, setConfigLoaded] = useState(false);

  // ── Auth state ──
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  // ── Initialize Telegram Mini App SDK ──
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);

  // ── Theme ──
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    localStorage.setItem("synapse-theme", theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  // ── Fetch runtime auth config from server ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/config");
        const cfg = await res.json();
        if (cfg.supabaseEnabled && cfg.supabaseUrl && cfg.supabaseAnonKey) {
          initSupabase(cfg.supabaseUrl, cfg.supabaseAnonKey);
          setAuthEnabled(true);
        } else {
          setAuthEnabled(false);
        }
      } catch {
        const { enabled } = getSupabaseState();
        setAuthEnabled(enabled);
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, []);

  // ── Supabase auth session management ──
  useEffect(() => {
    if (!configLoaded) return;

    const { client: currentSupabase, enabled: isEnabled } = getSupabaseState();

    if (!currentSupabase || !isEnabled) {
      setAuthLoading(false);
      return;
    }

    supabaseRef.current = currentSupabase;

    currentSupabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = currentSupabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [configLoaded]);

  // ── Auto-attach Supabase access token to all API requests ──
  useEffect(() => {
    const sb = supabaseRef.current;
    if (sb && session) {
      setAuthTokenGetter(async () => {
        const { data: { session: s } } = await sb.auth.getSession();
        return s?.access_token ?? null;
      });
    } else {
      setAuthTokenGetter(null);
    }
  }, [session, configLoaded]);

  const signOut = async () => {
    const sb = supabaseRef.current;
    if (sb) {
      await sb.auth.signOut();
      queryClient.clear();
    }
  };

  const authCtx: AuthCtx = { user, session, loading: authLoading, signOut };

  // ── Wait for runtime config to load ──
  if (!configLoaded) {
    return (
      <ThemeContext.Provider value={{ theme, toggle }}>
        <LoadingScreen />
      </ThemeContext.Provider>
    );
  }

  // ── Auth enabled: show loading or sign-in ──
  if (AUTH_ENABLED && authLoading) {
    return (
      <ThemeContext.Provider value={{ theme, toggle }}>
        <LoadingScreen />
      </ThemeContext.Provider>
    );
  }

  if (AUTH_ENABLED && !session) {
    return (
      <ThemeContext.Provider value={{ theme, toggle }}>
        <WouterRouter base={basePath}>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <SignInPage />
              <Toaster />
            </TooltipProvider>
          </QueryClientProvider>
        </WouterRouter>
      </ThemeContext.Provider>
    );
  }

  // ── Main app ──
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <AuthContext.Provider value={authCtx}>
        <WouterRouter base={basePath}>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <Router />
              <Toaster />
            </TooltipProvider>
          </QueryClientProvider>
        </WouterRouter>
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}

export default App;