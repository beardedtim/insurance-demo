import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { system } from "#/theme/system";

import { Markdown } from "./Markdown";

const render = (source: string): string =>
	renderToStaticMarkup(
		<ChakraProvider value={system}>
			<Markdown>{source}</Markdown>
		</ChakraProvider>,
	);

describe("Markdown", () => {
	it("renders bold text as a strong element", () => {
		const html = render("**hi**");

		expect(html).toContain("<strong");
		expect(html).not.toContain("**");
	});

	it("closes unterminated syntax while streaming", () => {
		const html = render("Hello **wor");

		expect(html).toContain("<strong");
		expect(html).not.toContain("**");
	});

	it("renders lists", () => {
		const html = render("- one\n- two");

		expect(html).toContain("<li");
		expect(html).toContain("one");
	});

	it("opens links in a new tab", () => {
		const html = render("[docs](https://example.com)");

		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain("noopener");
	});

	it("escapes raw html", () => {
		const html = render("<script>alert(1)</script>");

		expect(html).not.toContain("<script>");
	});
});
