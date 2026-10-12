import { Box, Code, Heading, Text } from "@chakra-ui/react";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<Box p="8">
			<Heading as="h1" size="4xl">
				Welcome to TanStack Start
			</Heading>
			<Text mt="4" textStyle="lg">
				Edit <Code>src/routes/index.tsx</Code> to get started.
			</Text>
		</Box>
	);
}
