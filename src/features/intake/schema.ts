import { z } from "zod";

import {
	claimWindowStart,
	isClaimDateInWindow,
	LIABILITY_LIMITS,
	meetsMinLiability,
	minLiabilityFor,
	todayIso,
} from "./rules";

export const US_STATES = [
	"AL",
	"AK",
	"AZ",
	"AR",
	"CA",
	"CO",
	"CT",
	"DE",
	"FL",
	"GA",
	"HI",
	"ID",
	"IL",
	"IN",
	"IA",
	"KS",
	"KY",
	"LA",
	"ME",
	"MD",
	"MA",
	"MI",
	"MN",
	"MS",
	"MO",
	"MT",
	"NE",
	"NV",
	"NH",
	"NJ",
	"NM",
	"NY",
	"NC",
	"ND",
	"OH",
	"OK",
	"OR",
	"PA",
	"RI",
	"SC",
	"SD",
	"TN",
	"TX",
	"UT",
	"VT",
	"VA",
	"WA",
	"WV",
	"WI",
	"WY",
] as const;

export const OWNERSHIP_STATUSES = ["owned", "leased", "financed"] as const;
export const DEDUCTIBLES = ["250", "500", "1000", "2000"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const applicantSchema = z.object({
	fullName: z.string().trim().min(1, "Full name is required"),
	dateOfBirth: isoDate,
	email: z.email("Enter a valid email address"),
	garagingState: z.enum(US_STATES),
});

export const vehicleSchema = z.object({
	year: z
		.number()
		.int()
		.min(1981)
		.max(new Date().getFullYear() + 1),
	make: z.string().trim().min(1, "Make is required"),
	model: z.string().trim().min(1, "Model is required"),
	annualMileage: z.number().int().positive("Must be greater than 0"),
	ownership: z.enum(OWNERSHIP_STATUSES),
});

export const coverageSchema = z.object({
	liabilityLimit: z.enum(LIABILITY_LIMITS),
	collisionDeductible: z.enum(DEDUCTIBLES),
	roadsideAssistance: z.boolean().optional(),
});

export const claimsSchema = z.object({
	atFaultClaims: z.number().int().min(0),
	mostRecentClaimDate: isoDate.optional(),
});

export const intakeSchema = z.object({
	applicant: applicantSchema,
	vehicle: vehicleSchema,
	coverage: coverageSchema,
	claims: claimsSchema,
});

export type IntakeValues = z.infer<typeof intakeSchema>;

export type IntakeDraft = {
	[K in keyof IntakeValues]?: Partial<IntakeValues[K]>;
};

export const intakeDraftSchema = z.object({
	applicant: applicantSchema.partial(),
	vehicle: vehicleSchema.partial(),
	coverage: coverageSchema.partial(),
	claims: claimsSchema.partial(),
});

export type FieldErrors = Record<string, string>;

/**
 * Cross-field rules. Runs on a draft so incomplete forms only report problems
 * with the values that are present (plus the claims "required iff" rule).
 */
export const crossFieldErrors = (
	draft: IntakeDraft,
	today: string = todayIso(),
): FieldErrors => {
	const errors: FieldErrors = {};
	const { garagingState } = draft.applicant ?? {};
	const { liabilityLimit } = draft.coverage ?? {};
	const { atFaultClaims, mostRecentClaimDate } = draft.claims ?? {};

	if (liabilityLimit && !meetsMinLiability(liabilityLimit, garagingState)) {
		errors["coverage.liabilityLimit"] =
			`${garagingState ?? "This state"} requires at least ${minLiabilityFor(garagingState)}`;
	}

	if (
		atFaultClaims !== undefined &&
		atFaultClaims > 0 &&
		!mostRecentClaimDate
	) {
		errors["claims.mostRecentClaimDate"] =
			"Required when there are at-fault claims";
	}

	if (atFaultClaims === 0 && mostRecentClaimDate) {
		errors["claims.mostRecentClaimDate"] =
			"Must be empty when there are no at-fault claims";
	}

	if (mostRecentClaimDate && !isClaimDateInWindow(mostRecentClaimDate, today)) {
		errors["claims.mostRecentClaimDate"] =
			`Must be between ${claimWindowStart(today)} and ${today}`;
	}

	return errors;
};

/** Zod issues -> flat `section.field` error map. */
export const zodErrors = (error: z.ZodError): FieldErrors =>
	Object.fromEntries(
		error.issues.map((issue) => [issue.path.join("."), issue.message]),
	);

/** Errors for the fields that are present in the draft, plus cross-field rules. */
export const validateDraft = (
	draft: IntakeDraft,
	today?: string,
): FieldErrors => {
	const parsed = intakeDraftSchema.safeParse({
		applicant: draft.applicant ?? {},
		vehicle: draft.vehicle ?? {},
		coverage: draft.coverage ?? {},
		claims: draft.claims ?? {},
	});

	return {
		...(parsed.success ? {} : zodErrors(parsed.error)),
		...crossFieldErrors(draft, today),
	};
};

/** Full validation for submission: every required field plus cross-field rules. */
export const validateComplete = (
	draft: IntakeDraft,
	today?: string,
): FieldErrors => {
	const parsed = intakeSchema.safeParse(draft);

	return {
		...(parsed.success ? {} : zodErrors(parsed.error)),
		...crossFieldErrors(draft, today),
	};
};
