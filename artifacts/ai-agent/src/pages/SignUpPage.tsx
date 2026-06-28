// Sign-up redirects to sign-in (Supabase OAuth handles both)
import { SignInPage } from "./SignInPage";

export function SignUpPage() {
  return <SignInPage />;
}