// AUTH_ENABLED now tracks the live runtime state of Supabase
// It's exported as a getter so components always see the current value
import { SUPABASE_ENABLED } from "@/lib/supabase";

// Re-export as a simple boolean for now — App.tsx will update
// the auth context after fetching runtime config
export let AUTH_ENABLED = !!SUPABASE_ENABLED;

/** Called from App.tsx after runtime config is loaded */
export function setAuthEnabled(val: boolean) {
  AUTH_ENABLED = val;
}