import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
	theme: {
		tokens: {},
		semanticTokens: {},
	},
});

export const system = createSystem(defaultConfig, config);
