import { SignIn } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4" style={{ background: "hsl(222 47% 8%)" }}>
      <div className="flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <img
            src="/synapse-icon.webp"
            alt="SYNAPSE"
            className="w-16 h-16 rounded-2xl"
            style={{ imageRendering: "pixelated" }}
          />
          <span className="synapse-logo-text text-lg font-bold tracking-widest uppercase" style={{ color: "hsl(25 95% 53%)" }}>
            SYNAPSE AGENT
          </span>
        </div>
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
        />
      </div>
    </div>
  );
}
