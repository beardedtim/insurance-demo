import { Box, Flex } from "@chakra-ui/react";

const delays = [undefined, "fast", "slow"] as const;

/** Three bouncing dots: shown while we wait on the LLM. */
export function TypingIndicator() {
	return (
		<Flex
			role="status"
			aria-label="Assistant is working"
			alignSelf="flex-start"
			align="center"
			gap="1"
			bg="bg.muted"
			borderRadius="l2"
			px="3"
			py="3"
		>
			{delays.map((delay) => (
				<Box
					key={delay ?? "none"}
					boxSize="1.5"
					borderRadius="full"
					bg="fg.muted"
					animation="bounce"
					animationDelay={delay}
				/>
			))}
		</Flex>
	);
}
