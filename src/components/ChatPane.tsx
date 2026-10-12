import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";
import { ActionTimeline } from "#/components/ActionTimeline";
import { Markdown } from "#/components/Markdown";
import { TypingIndicator } from "#/components/TypingIndicator";
import { intakeStore } from "#/features/intake/store";
import { sendChat } from "#/features/intake/stream-chat";

export function ChatPane() {
	const entries = useStore(intakeStore, (s) => s.entries);
	const streaming = useStore(intakeStore, (s) => s.streaming);
	const [draft, setDraft] = useState("");
	const last = entries.at(-1);

	// Waiting on the LLM: streaming, but no text is arriving and no action is mid-flight.
	const waiting =
		streaming &&
		(!last ||
			(last.role === "assistant" && !last.content) ||
			(last.role === "action" && last.status !== "running"));

	const submit = () => {
		const text = draft.trim();

		if (!text) {
			return;
		}

		setDraft("");
		void sendChat(text);
	};

	return (
		<Flex direction="column" h="full" minH="0">
			<Stack flex="1" minH="0" overflowY="auto" gap="3" p="4">
				{entries.map((entry, index) =>
					entry.role === "action" ? (
						<ActionTimeline key={entry.id} action={entry} />
					) : entry.role === "assistant" && !entry.content ? null : (
						<Box
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
							key={index}
							alignSelf={entry.role === "user" ? "flex-end" : "flex-start"}
							bg={entry.role === "user" ? "bg.emphasized" : "bg.muted"}
							borderRadius="l2"
							px="3"
							py="2"
							maxW="85%"
						>
							{entry.role === "user" ? (
								<Text whiteSpace="pre-wrap">{entry.content}</Text>
							) : (
								<Markdown>{entry.content}</Markdown>
							)}
						</Box>
					),
				)}
				{waiting && <TypingIndicator />}
			</Stack>
			<Flex
				as="form"
				gap="2"
				p="4"
				borderTopWidth="1px"
				onSubmit={(e: React.FormEvent) => {
					e.preventDefault();
					submit();
				}}
			>
				<Input
					placeholder="Message the assistant…"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
				/>
				<Button type="submit" loading={streaming}>
					Send
				</Button>
			</Flex>
		</Flex>
	);
}
