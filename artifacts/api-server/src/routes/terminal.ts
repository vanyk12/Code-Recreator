import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const router = Router();

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/home/runner/workspace";

router.post("/terminal/execute", async (req, res): Promise<void> => {
  try {
    const { command, cwd } = req.body;

    if (!command || typeof command !== "string") {
      res.status(400).json({ error: "Command is required" }); return;
    }

    const workingDir = cwd || WORKSPACE_ROOT;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workingDir,
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 5,
        env: { ...process.env, TERM: "xterm-256color" },
      });

      res.json({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: 0,
        command,
      });
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number };
      res.json({
        stdout: execErr.stdout || "",
        stderr: execErr.stderr || String(err),
        exitCode: execErr.code ?? 1,
        command,
      });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to execute command" });
  }
});

export default router;
