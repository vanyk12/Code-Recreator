import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Build-time VITE_ vars (for local dev / Replit)
const _buildTimeUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const _buildTimeKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Runtime Supabase configuration — set via `initSupabase()`
 * which fetches from /api/auth/config (no rebuild needed).
 */
let _supabaseClient: SupabaseClient | null = null;
let _supabaseEnabled = false;

/**
 * Initialize Supabase client from runtime config.
 * Falls back to build-time VITE_ vars if available (local dev).
 */
export function initSupabase(url: string, anonKey: string) {
  if (url && anonKey) {
    _supabaseClient = createClient(url, anonKey);
    _supabaseEnabled = true;
  }
}

/** Read the current supabase state (after possible runtime init) */
export function getSupabaseState() {
  // If no runtime init happened, check build-time vars
  if (!_supabaseEnabled && !_supabaseClient && _buildTimeUrl && _buildTimeKey) {
    _supabaseClient = createClient(_buildTimeUrl, _buildTimeKey);
    _supabaseEnabled = true;
  }
  return { client: _supabaseClient, enabled: _supabaseEnabled };
}

// Backwards-compatible exports
export const supabase = null as unknown as SupabaseClient; // placeholder, use getSupabaseState()
export const SUPABASE_ENABLED = false; // placeholder, use getSupabaseState()