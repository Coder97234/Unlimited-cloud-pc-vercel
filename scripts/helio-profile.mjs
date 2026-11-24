// CPU starter profile. Pin both the quantizer's revision and the final bytes.
// These artifacts are operator-installed, never part of the Vercel build.
export const HELIO_CPU_PROFILE = {
  'helio-2': {
    alias: 'Qwen3-0.6B-Q4_K_M',
    url: 'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/7bcae0bc7b0606f1e948f8cdb31b98a2c10635db/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
    size: 484_220_320,
    sha256: '9acfc1e001311f34b4252001b626f2e466d592a42065f66571bff3790d4e1b14',
  },
  'helio-3': {
    alias: 'Phi-3.5-mini-instruct.Q4_K_M',
    url: 'https://huggingface.co/QuantFactory/Phi-3.5-mini-instruct-GGUF/resolve/a1ee971221f67a2d6f572e47fddb95b9a8e365f5/Phi-3.5-mini-instruct.Q4_K_M.gguf',
    size: 2_393_232_384,
    sha256: '3ef532675b6684b28e0a1a0dca8b3bf4132673bf2294b7d87b41b1d64bb03bca',
  },
  'helio-4': {
    alias: 'Qwen3.5-4B-Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/720bb031aae5488eae5d6a78768e6d826662b2ae/Qwen3.5-4B-Q4_K_M.gguf',
    size: 2_740_937_888,
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
  },
};
