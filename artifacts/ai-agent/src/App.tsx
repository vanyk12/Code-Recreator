import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/Home";
import { SignInPage } from "@/pages/SignInPage";
import { useState, useEffect, createContext, useContext } from "react";
import { supabase, SUPABASE_ENABLED } from "@/lib/supabase";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import type { User, Session } from "@supabase/supabase-js";

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

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

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

  // ── Auth state ──
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(SUPABASE_ENABLED);

  useEffect(() => {
    // Initialize Telegram Mini App SDK if opened inside Telegram
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(theme);
    localStorage.setItem("synapse-theme", theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  // ── Supabase auth ──
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setAuthLoading(false);
    });

    // Listen for auth changes (OAuth redirect, sign out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Auto-attach Supabase access token to all API requests ──
  useEffect(() => {
    if (supabase && session) {
      setAuthTokenGetter(async () => {
        const { data: { session: s } } = await supabase.auth.getSession();
        return s?.access_token ?? null;
      });
    } else {
      setAuthTokenGetter(null);
    }
  }, [session]);

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
      queryClient.clear();
    }
  };

  const authCtx: AuthCtx = { user, session, loading: authLoading, signOut };

  // ── Render ──
  if (SUPABASE_ENABLED && authLoading) {
    return (
      <ThemeContext.Provider value={{ theme, toggle }}>
        <LoadingScreen />
      </ThemeContext.Provider>
    );
  }

  if (SUPABASE_ENABLED && !session) {
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