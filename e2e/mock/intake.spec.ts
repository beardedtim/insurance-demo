import { expect, test } from "@playwright/test";

import { field, fillTurn, mock, say, turnDone } from "../support.ts";

test.beforeEach(async ({ page }) => {
	await mock.reset();
	// The page is server-rendered; typing before hydration would drop the input events.
	await page.goto("/", { waitUntil: "networkidle" });
});

test.describe("conversation -> structured updates -> form", () => {
	test("the agent fills the form and the fields read as suggestions", async ({
		page,
	}) => {
		await mock.script(
			fillTurn(
				{
					applicant: { fullName: "Ada Lovelace", email: "ada@example.com" },
					vehicle: { year: 2020, make: "Toyota", model: "Corolla" },
				},
				"Thanks Ada! What is your date of birth?",
			),
		);

		await say(page, "I'm Ada Lovelace (ada@example.com) with a 2020 Toyota Corolla");

		await expect(field(page, "Full name")).toHaveValue("Ada Lovelace");
		await expect(field(page, "Email")).toHaveValue("ada@example.com");
		await expect(field(page, "Year")).toHaveValue("2020");
		await expect(field(page, "Make")).toHaveValue("Toyota");
		await expect(field(page, "Model")).toHaveValue("Corolla");
		await expect(page.getByText("Suggested")).toHaveCount(5);
		await expect(page.getByText("What is your date of birth?")).toBeVisible();
		await expect(page.getByText("Updating the form")).toBeVisible();
	});

	test("the user can confirm a suggestion", async ({ page }) => {
		await mock.script(fillTurn({ vehicle: { make: "Toyota" } }, "Saved."));
		await say(page, "It's a Toyota");
		await expect(page.getByText("Suggested")).toHaveCount(1);

		await page.getByRole("button", { name: "Confirm" }).click();

		await expect(page.getByText("Confirmed")).toHaveCount(1);
		await expect(page.getByText("Suggested")).toHaveCount(0);
	});

	test("an invalid proposal is rejected field by field and explained on the field", async ({
		page,
	}) => {
		await mock.script(
			fillTurn(
				{ vehicle: { make: "Toyota", year: 1900 } },
				"I couldn't save that year.",
			),
		);

		await say(page, "A 1900 Toyota");

		await expect(field(page, "Make")).toHaveValue("Toyota");
		await expect(field(page, "Year")).toHaveValue("");
		await expect(page.getByText(/Suggestion not saved/)).toBeVisible();
	});
});

test.describe("user edits a field -> agent respects it", () => {
	test("a hand edit survives an agent attempt to revert it", async ({ page }) => {
		await mock.script(
			fillTurn({ applicant: { garagingState: "CA" } }, "Noted, California."),
		);
		await say(page, "I live in California");
		await expect(field(page, "Garaging state")).toHaveValue("CA");

		await field(page, "Garaging state").selectOption("NY");
		await expect(page.getByText("Edited by you")).toBeVisible();

		// Next turn the model tries to put CA back; the user never asked for that.
		await mock.script(
			fillTurn({ applicant: { garagingState: "CA" } }, "I'll keep New York."),
		);
		await say(page, "what else do you need?");
		await turnDone(page);

		await expect(field(page, "Garaging state")).toHaveValue("NY");
		await expect(page.getByText(/Suggestion not saved/)).toBeVisible();
		await expect(page.getByText("I'll keep New York.")).toBeVisible();

		// The agent was told about the edit on the way in.
		const requests = await mock.requests();
		const system = requests.at(-1)?.messages[0]?.content ?? "";

		expect(system).toContain('applicant.garagingState: "CA" -> "NY"');
		expect(system).toContain('"garagingState":"NY"');
	});

	test("the agent can change a hand-edited field when the user asks", async ({
		page,
	}) => {
		await field(page, "Garaging state").selectOption("CA");
		await mock.script(
			fillTurn({ applicant: { garagingState: "TX" } }, "Switched to Texas."),
		);

		await say(page, "actually, change my state to TX");

		await expect(field(page, "Garaging state")).toHaveValue("TX");
	});
});

test.describe("user requests a human -> Slack handoff", () => {
	test("sends the transcript and the partial application, once", async ({
		page,
	}) => {
		await mock.script(
			fillTurn({ applicant: { fullName: "Ada Lovelace" } }, "Nice to meet you."),
		);
		await say(page, "I'm Ada Lovelace");
		await turnDone(page);

		await mock.script([
			{ tools: [{ name: "pingSlack", args: { reason: "wants a person" } }] },
			{ text: "I've notified the team." },
		]);
		await say(page, "let me talk to a human");

		await expect(
			page.getByText("The customer-service team has been notified"),
		).toBeVisible();

		const [handoff, ...rest] = await mock.slack();

		expect(rest).toHaveLength(0);
		expect(handoff?.text).toContain("wants a person");
		expect(handoff?.text).toContain("let me talk to a human");
		expect(handoff?.text).toContain("Ada Lovelace");
		expect(handoff?.text).toContain("applicant.email");

		// Asking again must not page the team a second time.
		await mock.script([
			{ tools: [{ name: "pingSlack", args: {} }] },
			{ text: "They already know." },
		]);
		await say(page, "human please, again");
		await expect(page.getByText("They already know.")).toBeVisible();

		expect(await mock.slack()).toHaveLength(1);
	});
});
