import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * Returns public Supabase configuration to the frontend at runtime.
 * This avoids the need for VITE_* build-time variables on Railway.
 * The anon key is safe to expose — it's designed to be public.
 */
router.get("/auth/config", (_req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "";

  res.json({
    supabaseEnabled: !!(supabaseUrl && supabaseAnonKey),
    supabaseUrl,
    supabaseAnonKey,
  });
});

export default router;