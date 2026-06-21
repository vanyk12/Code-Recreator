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

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(25 95% 53%)",
    colorForeground: "hsl(210 20% 90%)",
    colorMutedForeground: "hsl(210 15% 55%)",
    colorDanger: "hsl(0 72% 51%)",
    colorBackground: "hsl(220 40% 11%)",
    colorInput: "hsl(220 35% 13%)",
    colorInputForeground: "hsl(210 20% 90%)",
    colorNeutral: "hsl(220 30% 18%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "w-[440px] max-w-full overflow-hidden rounded-2xl" as unknown as string,
    card: "!shadow-none !border-0 !rounded-none" as unknown as string,
    footer: "!shadow-none !border-0 !rounded-none" as unknown as string,
    headerTitle: { color: "hsl(210 20% 90%)" },
    headerSubtitle: { color: "hsl(210 15% 55%)" },
    socialButtonsBlockButtonText: { color: "hsl(210 20% 90%)" },
    formFieldLabel: { color: "hsl(210 15% 65%)" },
    footerActionLink: { color: "hsl(25 95% 53%)" },
    footerActionText: { color: "hsl(210 15% 55%)" },
    dividerText: { color: "hsl(210 15% 45%)" },
    identityPreviewEditButton: { color: "hsl(25 95% 53%)" },
    formFieldSuccessText: { color: "hsl(142 76% 45%)" },
    alertText: { color: "hsl(210 20% 90%)" },
    logoBox: { margin: "0 auto 4px" },
    logoImage: { width: "48px", height: "48px" },
    socialButtonsBlockButton: { borderColor: "hsl(220 30% 22%)", backgroundColor: "hsl(220 35% 15%)" },
    formButtonPrimary: { backgroundColor: "hsl(25 95% 53%)", color: "hsl(222 47% 8%)" },
    formFieldInput: { backgroundColor: "hsl(220 35% 13%)", borderColor: "hsl(220 30% 20%)", color: "hsl(210 20% 90%)" },
    footerAction: { backgroundColor: "transparent" },
    dividerLine: { backgroundColor: "hsl(220 30% 18%)" },
    alert: { borderColor: "hsl(220 30% 22%)" },
    otpCodeFieldInput: { backgroundColor: "hsl(220 35% 13%)", borderColor: "hsl(220 30% 20%)", color: "hsl(210 20% 90%)" },
    formFieldRow: {},
    main: {},
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
