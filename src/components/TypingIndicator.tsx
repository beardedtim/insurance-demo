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
			bg="chat.assistant.bg"
			borderWidth="1px"
			borderColor="chat.assistant.border"
			shadow="chat.bubble"
			borderRadius="2xl"
			borderBottomLeftRadius="sm"
			px="4"
			py="3"
			animation="messageIn"
		>
			{delays.map((delay) => (
				<Box
					key={delay ?? "none"}
					boxSize="1.5"
					borderRadius="full"
					bg="fg.subtle"
					animation="bounce"
					animationDelay={delay}
				/>
			))}
		</Flex>
	);
}
