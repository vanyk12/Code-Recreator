import { Router } from "express";

const router = Router();

const BUILTIN_MODELS = [
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", contextLength: 200000, description: "Best for coding and analysis" },
  { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", contextLength: 200000, description: "Fast and efficient" },
  { id: "anthropic/claude-opus-4", name: "Claude Opus 4", contextLength: 200000, description: "Most capable Claude model" },
  { id: "openai/gpt-4o", name: "GPT-4o", contextLength: 128000, description: "OpenAI flagship model" },
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", contextLength: 128000, description: "Fast and cheap" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", contextLength: 1000000, description: "Google fast model" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLength: 2000000, description: "Google most capable" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextLength: 128000, description: "Open source powerhouse" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", contextLength: 64000, description: "Reasoning model" },
  { id: "mistralai/mistral-large-2411", name: "Mistral Large", contextLength: 128000, description: "European flagship" },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", contextLength: 40000, description: "Large open model" },
  { id: "x-ai/grok-3", name: "Grok 3", contextLength: 131072, description: "xAI latest model" },
];

router.get("/models", async (req, res): Promise<void> => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      res.json(BUILTIN_MODELS); return;
    }

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      res.json(BUILTIN_MODELS); return;
    }

    const data = await response.json() as { data?: { id: string; name: string; context_length: number; description?: string }[] };
    const models = (data.data || [])
      .filter((m) => m.context_length > 0)
      .map((m) => ({
        id: m.id,
        name: m.name,
        contextLength: m.context_length,
        description: m.description || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(models.length > 0 ? models : BUILTIN_MODELS);
  } catch (err) {
    req.log.error(err);
    res.json(BUILTIN_MODELS);
  }
});

export default router;
