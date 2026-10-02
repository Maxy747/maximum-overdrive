# M.A.X., the coach

An optional AI coach inside the app: it checks in on your day, gives a short piece of advice each morning, writes the
"right now" insight on Today, and can fill in your tracker from what you tell it ("I did 20 push-ups and had lunch").
Without a model configured the coach tab is hidden and everything else works the same; advice and insights then come
from simple rules instead.

Each person can switch the coach off in Profile. `MAX_FEATURES` without `coach` turns it off for everyone.

## What it sends

For each reply, the coach sends that person's goals and progress for today, their streaks, this week's summary, their
weight goal if they have one, their latest mood and its note (from the last 18 hours), the titles and dates of
upcoming countdowns and birthdays, and the chat itself. It never sends journal memories, diary entries, photos,
hidden photos, or anything of the partner's beyond their name and birthday. With a hosted API, that
data goes to that provider. With a local model it stays on your machine.

## Option 1: any OpenAI-compatible API

Set the base URL (ending in `/v1` or the provider's equivalent), the model and, for hosted APIs, a key:

```bash
MAX_COACH_URL=https://api.example.com/v1
MAX_COACH_API_KEY=your-key
MAX_COACH_MODEL_NAME=model-id-from-your-provider
```

Base URLs for common providers:

| Provider | `MAX_COACH_URL` |
|---|---|
| Ollama | `http://127.0.0.1:11434/v1` (from Docker: `http://host.docker.internal:11434/v1`) |
| LM Studio | `http://127.0.0.1:1234/v1` |
| llama.cpp `llama-server` | `http://127.0.0.1:8080/v1` (also set `MAX_COACH_LLAMACPP=1`) |
| Groq | `https://api.groq.com/openai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |

Use a model id from your provider's model list (for Ollama, a model you've pulled, e.g. `llama3.2:3b`).

"Log it for me" asks the model for structured JSON output (`response_format` with a JSON schema). Models or APIs
without structured outputs still chat fine; they just won't fill in the tracker from messages.

## Option 2: a local llama.cpp model started by the server

On a machine without a GPU, a small instruct model (3B parameters, Q4 quantization) runs acceptably on a few CPU
cores. Point the server at a `llama-server` binary and a GGUF model; it starts the model on its own port, keeps it
loaded, and keeps each prompt cached so replies start quickly:

```bash
MAX_COACH_LLAMA_SERVER=/opt/llama.cpp/llama-server
MAX_COACH_MODEL=/opt/models/your-model.gguf
MAX_COACH_THREADS=3            # CPU threads for the model
MAX_COACH_IDLE_SECONDS=0       # >0 unloads it after that many idle seconds
```

On a small CPU requests are answered one at a time (a few can wait in line).
