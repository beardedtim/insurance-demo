export const LIABILITY_LIMITS = [
	"10/20",
	"25/50",
	"30/60",
	"50/100",
	"100/300",
	"250/500",
] as const;

export type LiabilityLimit = (typeof LIABILITY_LIMITS)[number];

export const DEFAULT_MIN_LIABILITY: LiabilityLimit = "25/50";

export const MIN_LIABILITY_BY_STATE: Record<string, LiabilityLimit> = {
	CA: "30/60",
	NY: "50/100",
	FL: "10/20",
};

export const CLAIM_WINDOW_YEARS = 5;

export const minLiabilityFor = (state: string | undefined): LiabilityLimit =>
	(state && MIN_LIABILITY_BY_STATE[state]) || DEFAULT_MIN_LIABILITY;

export const meetsMinLiability = (
	limit: LiabilityLimit,
	state: string | undefined,
): boolean =>
	LIABILITY_LIMITS.indexOf(limit) >=
	LIABILITY_LIMITS.indexOf(minLiabilityFor(state));

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const todayIso = (): string => toIsoDate(new Date());

export const claimWindowStart = (today: string): string => {
	const date = new Date(`${today}T00:00:00Z`);

	date.setUTCFullYear(date.getUTCFullYear() - CLAIM_WINDOW_YEARS);

	return toIsoDate(date);
};

export const isClaimDateInWindow = (date: string, today: string): boolean =>
	date >= claimWindowStart(today) && date <= today;
