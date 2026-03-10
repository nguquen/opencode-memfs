import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    server: {
      deps: {
        // Inline the plugin so vitest can resolve its internal imports
        inline: ["@opencode-ai/plugin"],
      },
    },
  },
})
