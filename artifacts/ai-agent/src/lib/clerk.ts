// Clerk is enabled only when VITE_CLERK_PUBLISHABLE_KEY is explicitly set at build time
export const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
