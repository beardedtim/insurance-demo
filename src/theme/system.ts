import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
	theme: {
		keyframes: {
			messageIn: {
				from: { opacity: "0", transform: "translateY(0.5rem)" },
				to: { opacity: "1", transform: "translateY(0)" },
			},
		},
		tokens: {
			animations: {
				messageIn: {
					value: "messageIn {durations.moderate} {easings.ease-out}",
				},
			},
		},
		semanticTokens: {
			colors: {
				chat: {
					user: {
						bg: {
							value: {
								_light: "{colors.blue.600}",
								_dark: "{colors.blue.500}",
							},
						},
						fg: { value: "{colors.white}" },
					},
					assistant: {
						bg: { value: "{colors.bg.panel}" },
						border: { value: "{colors.border.muted}" },
					},
					composer: {
						border: { value: "{colors.border}" },
					},
				},
			},
			shadows: {
				"chat.bubble": { value: "{shadows.xs}" },
				"chat.composer": { value: "{shadows.md}" },
			},
		},
	},
});

export const system = createSystem(defaultConfig, config);
