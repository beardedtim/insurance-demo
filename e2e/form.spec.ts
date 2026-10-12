import { expect, test } from "@playwright/test";

import { field } from "./support.ts";

// These never reach the model, so they run in both the mock and the live project.
test.beforeEach(async ({ page }) => {
	// The page is server-rendered; typing before hydration would drop the input events.
	await page.goto("/", { waitUntil: "networkidle" });
});

test.describe("validation and rules in the form", () => {
	test("flags a malformed email", async ({ page }) => {
		await field(page, "Email").fill("not-an-email");

		await expect(page.getByText("Enter a valid email address")).toBeVisible();

		await field(page, "Email").fill("ada@example.com");

		await expect(page.getByText("Enter a valid email address")).toBeHidden();
	});

	test("liability options follow the garaging state minimum", async ({ page }) => {
		const options = () =>
			page.getByLabel(/^Liability limit/).locator("option").allTextContents();

		await field(page, "Garaging state").selectOption("NY");

		expect(await options()).not.toContain("25/50");
		expect(await options()).toContain("50/100");

		await field(page, "Garaging state").selectOption("FL");

		expect(await options()).toContain("10/20");
	});

	test("the claim date is required if and only if there are claims", async ({
		page,
	}) => {
		const date = field(page, "Most recent claim date");

		await field(page, "At-fault claims").fill("2");

		await expect(
			page.getByText("Required when there are at-fault claims"),
		).toBeVisible();

		await date.fill("2010-01-01");

		await expect(page.getByText(/Must be between/)).toBeVisible();

		await field(page, "At-fault claims").fill("0");

		await expect(date).toBeDisabled();
	});
});
