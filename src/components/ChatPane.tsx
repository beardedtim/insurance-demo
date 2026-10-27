import {
	Alert,
	Box,
	Button,
	EmptyState,
	Flex,
	Input,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useStore } from "@tanstack/react-store";
import { useLayoutEffect, useRef, useState } from "react";
import { ActionTimeline } from "#/components/ActionTimeline";
import { Markdown } from "#/components/Markdown";
import { TypingIndicator } from "#/components/TypingIndicator";
import { intakeStore } from "#/features/intake/store";
import { sendChat } from "#/features/intake/stream-chat";

/** How close (in CSS px) to the bottom still counts as "following" the stream. */
const STICK_THRESHOLD = 48;

export function ChatPane() {
	const entries = useStore(intakeStore, (s) => s.entries);
	const streaming = useStore(intakeStore, (s) => s.streaming);
	const handoff = useStore(intakeStore, (s) => s.handoff);
	const [draft, setDraft] = useState("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);
	const last = entries.at(-1);

	// Waiting on the LLM: streaming, but no text is arriving and no action is mid-flight.
	const waiting =
		streaming &&
		(!last ||
			(last.role === "assistant" && !last.content) ||
			(last.role === "action" && last.status !== "running"));

	// Runs on every new entry, streamed delta, action update, or indicator change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when content changes
	useLayoutEffect(() => {
		const el = scrollRef.current;

		if (!el || !stickRef.current) {
			return;
		}

		el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
	}, [entries, waiting]);

	const onScroll = () => {
		const el = scrollRef.current;

		if (!el) {
			return;
		}

		stickRef.current =
			el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
	};

	const submit = () => {
		const text = draft.trim();

		if (!text) {
			return;
		}

		setDraft("");
		stickRef.current = true;
		void sendChat(text);
	};

	return (
		<Flex direction="column" h="full" minH="0">
			{handoff.status === "sent" && (
				<Alert.Root status="success" borderRadius="none">
					<Alert.Indicator />
					<Alert.Content>
						<Alert.Title>
							The customer-service team has been notified
						</Alert.Title>
						<Alert.Description>Reference {handoff.ref}</Alert.Description>
					</Alert.Content>
				</Alert.Root>
			)}
			<Stack
				ref={scrollRef}
				onScroll={onScroll}
				flex="1"
				minH="0"
				overflowY="auto"
				gap="4"
				p="4"
			>
				{entries.length === 0 && (
					<EmptyState.Root flex="1">
						<EmptyState.Content>
							<EmptyState.Title>
								Ask me to help you fill out the form
							</EmptyState.Title>
						</EmptyState.Content>
					</EmptyState.Root>
				)}
				{entries.map((entry, index) =>
					entry.role === "action" ? (
						<ActionTimeline key={entry.id} action={entry} />
					) : entry.role === "assistant" && !entry.content ? null : (
						<Box
							// biome-ignore lint/suspicious/noArrayIndexKey: append-only list
							key={index}
							alignSelf={entry.role === "user" ? "flex-end" : "flex-start"}
							bg={entry.role === "user" ? "chat.user.bg" : "chat.assistant.bg"}
							color={entry.role === "user" ? "chat.user.fg" : undefined}
							borderWidth={entry.role === "user" ? undefined : "1px"}
							borderColor="chat.assistant.border"
							shadow="chat.bubble"
							borderRadius="2xl"
							borderBottomRightRadius={entry.role === "user" ? "sm" : undefined}
							borderBottomLeftRadius={entry.role === "user" ? undefined : "sm"}
							px="4"
							py="2.5"
							maxW="85%"
							animation="messageIn"
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
				align="center"
				gap="2"
				m="4"
				p="1.5"
				ps="4"
				bg="bg.panel"
				borderWidth="1px"
				borderColor="chat.composer.border"
				borderRadius="full"
				shadow="chat.composer"
				_focusWithin={{ borderColor: "colorPalette.focusRing" }}
				onSubmit={(e: React.FormEvent) => {
					e.preventDefault();
					submit();
				}}
			>
				<Input
					variant="flushed"
					borderBottomWidth="0"
					_focus={{ outline: "none", boxShadow: "none" }}
					placeholder="Message the assistant…"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
				/>
				<Button type="submit" borderRadius="full" px="5" loading={streaming}>
					Send
				</Button>
			</Flex>
		</Flex>
	);
}
