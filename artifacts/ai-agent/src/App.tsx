import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Home } from "@/pages/Home";
import { SignInPage } from "@/pages/SignInPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { useState, useEffect, createContext, useContext, useRef } from "react";
import { ClerkProvider, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";

const queryClient = new QueryClient();

type Theme = "dark" | "light";
interface ThemeCtx { theme: Theme; toggle: () => void }
export const ThemeContext = createContext<ThemeCtx>({ theme: "dark", toggle: () => {} });
export function useTheme() { return useContext(ThemeContext); }

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const BG = "hsl(220 40% 11%)";
const CARD_BG = "hsl(220 35% 14%)";
const BORDER = "hsl(220 30% 22%)";
const TEXT = "hsl(210 20% 90%)";
const MUTED = "hsl(210 15% 55%)";
const ACCENT = "hsl(25 95% 53%)";
const INPUT_BG = "hsl(220 35% 10%)";

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  variables: {
    colorPrimary: ACCENT,
    colorForeground: TEXT,
    colorMutedForeground: MUTED,
    colorDanger: "hsl(0 72% 51%)",
    colorBackground: CARD_BG,
    colorInput: INPUT_BG,
    colorInputForeground: TEXT,
    colorNeutral: "hsl(220 30% 18%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: { width: "100%", display: "flex", justifyContent: "center" },
    cardBox: {
      width: "440px",
      maxWidth: "100%",
      borderRadius: "1rem",
      overflow: "hidden",
      border: `1px solid ${BORDER}`,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    },
    card: { background: CARD_BG, boxShadow: "none", border: "none", borderRadius: "0" },
    footer: { background: CARD_BG, boxShadow: "none", border: "none", borderTop: `1px solid ${BORDER}` },
    main: { background: CARD_BG },
    header: { background: CARD_BG },
    headerTitle: { color: TEXT },
    headerSubtitle: { color: MUTED },
    socialButtonsBlockButton: { borderColor: BORDER, backgroundColor: "hsl(220 35% 18%)", color: TEXT },
    socialButtonsBlockButtonText: { color: TEXT },
    formFieldLabel: { color: MUTED },
    formFieldInput: { backgroundColor: INPUT_BG, borderColor: BORDER, color: TEXT },
    formButtonPrimary: { backgroundColor: ACCENT, color: "hsl(222 47% 8%)" },
    footerActionLink: { color: ACCENT },
    footerActionText: { color: MUTED },
    footerAction: { background: CARD_BG },
    dividerText: { color: "hsl(210 15% 45%)" },
    dividerLine: { backgroundColor: BORDER },
    identityPreviewEditButton: { color: ACCENT },
    formFieldSuccessText: { color: "hsl(142 76% 45%)" },
    alertText: { color: TEXT },
    alert: { borderColor: BORDER },
    logoBox: { margin: "0 auto 4px" },
    logoImage: { width: "48px", height: "48px" },
    otpCodeFieldInput: { backgroundColor: INPUT_BG, borderColor: BORDER, color: TEXT },
    pageScrollBox: { background: CARD_BG },
    form: { background: CARD_BG },
    navbar: { background: CARD_BG },
    navbarButton: { color: TEXT },
    profileSectionTitleText: { color: TEXT },
    userPreviewMainIdentifier: { color: TEXT },
    userPreviewSecondaryIdentifier: { color: MUTED },
    menuList: { background: BG, border: `1px solid ${BORDER}` },
    menuItem: { color: TEXT },
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <Home />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Добро пожаловать",
            subtitle: "Войдите в свой аккаунт",
          },
        },
        signUp: {
          start: {
            title: "Создать аккаунт",
            subtitle: "Начните работу с SYNAPSE AGENT",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("synapse-theme") as Theme) || "dark";
  });

  useEffect(() => {
    // Initialize Telegram Mini App SDK if opened inside Telegram
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
    </ThemeContext.Provider>
  );
}

export default App;
