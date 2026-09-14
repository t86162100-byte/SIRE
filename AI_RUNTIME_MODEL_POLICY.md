# SIRE AI runtime model policy

Effective 2026-09-14.

SIRE uses NVIDIA-hosted models only for its AI runtime:

1. Primary: `moonshotai/kimi-k3` (Kimi K3)
2. Fallback: `deepseek-ai/deepseek-v4-pro-0813` (DeepSeek V4 Pro)

The retired `openai/gpt-oss-120b` model must not be used anywhere in the runtime. HTTP 404/410/422 model-unavailable responses must advance to the next configured model instead of surfacing the retired model name to the user.
