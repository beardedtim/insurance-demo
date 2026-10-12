import { Badge, Box, Spinner, Text, Timeline } from "@chakra-ui/react";

import type { ActionEntry } from "#/features/intake/store";

const statusPalette = { done: "green", failed: "red" } as const;

/** One "the agent did X" row in the chat. Easy to swap for another presentation. */
export function ActionTimeline({ action }: { action: ActionEntry }) {
	const palette =
		action.status === "running" ? "gray" : statusPalette[action.status];

	return (
		<Box
			bg="chat.assistant.bg"
			borderWidth="1px"
			borderColor="chat.assistant.border"
			shadow="chat.bubble"
			borderRadius="xl"
			px="3"
			py="2"
			animation="messageIn"
		>
			<Timeline.Root size="sm" variant="plain" colorPalette={palette}>
				<Timeline.Item>
					<Timeline.Connector>
						<Timeline.Separator />
						<Timeline.Indicator>
							{action.status === "running" ? <Spinner size="xs" /> : null}
						</Timeline.Indicator>
					</Timeline.Connector>
					<Timeline.Content>
						<Timeline.Title>
							<Text as="span" color="fg.muted">
								Agent:
							</Text>{" "}
							{action.label}{" "}
							{action.status !== "running" && (
								<Badge size="sm">
									{action.status === "done" ? "done" : "failed"}
								</Badge>
							)}
						</Timeline.Title>
						{action.detail && (
							<Timeline.Description>{action.detail}</Timeline.Description>
						)}
					</Timeline.Content>
				</Timeline.Item>
			</Timeline.Root>
		</Box>
	);
}
