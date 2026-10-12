import { Box, Grid } from "@chakra-ui/react";
import { createFileRoute } from "@tanstack/react-router";

import { ChatPane } from "#/components/ChatPane";
import { IntakeForm } from "#/components/IntakeForm";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<Grid
			templateColumns={{ base: "1fr", md: "1fr 1fr" }}
			templateRows={{ base: "1fr 1fr", md: "1fr" }}
			h="100dvh"
		>
			<Box minH="0" borderRightWidth={{ md: "1px" }} bg="bg.subtle">
				<ChatPane />
			</Box>
			<Box minH="0" overflowY="auto">
				<IntakeForm />
			</Box>
		</Grid>
	);
}
