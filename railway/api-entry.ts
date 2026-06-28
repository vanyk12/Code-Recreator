// ====================================================================
// Railway API Entry Point
// ====================================================================
// Same as the original index.ts but EXPORTS the app instead of
// calling app.listen(). This lets the start script add static
// file serving before binding to a port.
// ====================================================================
import app from "./app";

export default app;