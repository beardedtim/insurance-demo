import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";
import { Markdown } from "#/components/Markdown";
import { intakeStore } from "#/features/intake/store";
import { sendChat } from "#/features/intake/stream-chat";

export function ChatPane() {
	const messages = useStore(intakeStore, (s) => s.messages);
	const streaming = useStore(intakeStore, (s) => s.streaming);
	const handoff = useStore(intakeStore, (s) => s.handoff);
	const [draft, setDraft] = useState("");

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
				{messages.map((message, index) => (
					<Box
						// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
						key={index}
						alignSelf={message.role === "user" ? "flex-end" : "flex-start"}
						bg={message.role === "user" ? "bg.emphasized" : "bg.muted"}
						borderRadius="l2"
						px="3"
						py="2"
						maxW="85%"
					>
						{message.role === "user" ? (
							<Text whiteSpace="pre-wrap">{message.content}</Text>
						) : (
							<Markdown>{message.content || "…"}</Markdown>
						)}
					</Box>
				))}
			</Stack>
			{handoff.status === "sent" && (
				<Text px="4" py="2" fontSize="sm" color="fg.muted" bg="bg.subtle">
					A team member has been notified (ref {handoff.ref}).
				</Text>
			)}
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
