import {
	Blockquote,
	Box,
	Code,
	Heading,
	Link,
	List,
	Separator,
	Stack,
	Table,
	Text,
} from "@chakra-ui/react";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";

const components: Components = {
	p: ({ children }) => <Text>{children}</Text>,
	a: ({ href, children }) => (
		<Link
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			variant="underline"
		>
			{children}
		</Link>
	),
	h1: ({ children }) => (
		<Heading as="h1" size="lg">
			{children}
		</Heading>
	),
	h2: ({ children }) => (
		<Heading as="h2" size="md">
			{children}
		</Heading>
	),
	h3: ({ children }) => (
		<Heading as="h3" size="sm">
			{children}
		</Heading>
	),
	ul: ({ children }) => (
		<List.Root ps="4" gap="1">
			{children}
		</List.Root>
	),
	ol: ({ children }) => (
		<List.Root as="ol" listStyle="decimal" ps="4" gap="1">
			{children}
		</List.Root>
	),
	li: ({ children }) => <List.Item>{children}</List.Item>,
	strong: ({ children }) => (
		<Text as="strong" fontWeight="semibold">
			{children}
		</Text>
	),
	em: ({ children }) => <Text as="em">{children}</Text>,
	code: ({ children }) => <Code>{children}</Code>,
	pre: ({ children }) => (
		<Box
			as="pre"
			bg="bg.subtle"
			borderRadius="l2"
			p="3"
			fontSize="sm"
			overflowX="auto"
			css={{ "& code": { bg: "transparent", p: "0" } }}
		>
			{children}
		</Box>
	),
	blockquote: ({ children }) => (
		<Blockquote.Root>
			<Blockquote.Content>{children}</Blockquote.Content>
		</Blockquote.Root>
	),
	hr: () => <Separator />,
	table: ({ children }) => (
		<Table.ScrollArea borderWidth="1px" borderRadius="l2">
			<Table.Root size="sm" variant="outline">
				{children}
			</Table.Root>
		</Table.ScrollArea>
	),
	thead: ({ children }) => <Table.Header>{children}</Table.Header>,
	tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
	tr: ({ children }) => <Table.Row>{children}</Table.Row>,
	th: ({ children }) => <Table.ColumnHeader>{children}</Table.ColumnHeader>,
	td: ({ children }) => <Table.Cell>{children}</Table.Cell>,
};

const remarkPlugins = [remarkGfm];

/** Renders markdown that may still be streaming; `remend` closes unterminated syntax. */
export const Markdown = memo(function Markdown({
	children,
}: {
	children: string;
}) {
	return (
		<Stack gap="2">
			<ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
				{remend(children)}
			</ReactMarkdown>
		</Stack>
	);
});
