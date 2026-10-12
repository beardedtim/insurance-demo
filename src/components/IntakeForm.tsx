import { Box, Fieldset, Heading, SimpleGrid, Stack } from "@chakra-ui/react";
import { useStore } from "@tanstack/react-store";

import {
	allowedLiabilityLimitsFor,
	minLiabilityFor,
} from "#/features/intake/rules";
import {
	DEDUCTIBLES,
	OWNERSHIP_STATUSES,
	US_STATES,
} from "#/features/intake/schema";
import { intakeStore, setField } from "#/features/intake/store";
import { NumberField, SelectField, SwitchField, TextField } from "./fields";

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<Fieldset.Root>
			<Fieldset.Legend asChild>
				<Heading as="h2" size="md">
					{title}
				</Heading>
			</Fieldset.Legend>
			<Fieldset.Content>
				<SimpleGrid columns={{ base: 1, md: 2 }} gap="4">
					{children}
				</SimpleGrid>
			</Fieldset.Content>
		</Fieldset.Root>
	);
}

export function IntakeForm() {
	const values = useStore(intakeStore, (s) => s.values);
	const errors = useStore(intakeStore, (s) => s.errors);
	const { applicant, vehicle, coverage, claims } = values;
	const noClaims = claims?.atFaultClaims === 0;

	return (
		<Stack gap="8" p="6">
			<Section title="Applicant">
				<TextField
					path="applicant.fullName"
					label="Full name"
					required
					value={applicant?.fullName}
					error={errors["applicant.fullName"]}
					onChange={(v) => setField("applicant", "fullName", v)}
				/>
				<TextField
					path="applicant.dateOfBirth"
					label="Date of birth"
					type="date"
					required
					value={applicant?.dateOfBirth}
					error={errors["applicant.dateOfBirth"]}
					onChange={(v) => setField("applicant", "dateOfBirth", v)}
				/>
				<TextField
					path="applicant.email"
					label="Email"
					type="email"
					required
					value={applicant?.email}
					error={errors["applicant.email"]}
					onChange={(v) => setField("applicant", "email", v)}
				/>
				<SelectField
					path="applicant.garagingState"
					label="Garaging state"
					required
					value={applicant?.garagingState}
					options={US_STATES}
					error={errors["applicant.garagingState"]}
					onChange={(v) => setField("applicant", "garagingState", v)}
				/>
			</Section>

			<Section title="Vehicle">
				<NumberField
					path="vehicle.year"
					label="Year"
					required
					value={vehicle?.year}
					error={errors["vehicle.year"]}
					onChange={(v) => setField("vehicle", "year", v)}
				/>
				<TextField
					path="vehicle.make"
					label="Make"
					required
					value={vehicle?.make}
					error={errors["vehicle.make"]}
					onChange={(v) => setField("vehicle", "make", v)}
				/>
				<TextField
					path="vehicle.model"
					label="Model"
					required
					value={vehicle?.model}
					error={errors["vehicle.model"]}
					onChange={(v) => setField("vehicle", "model", v)}
				/>
				<NumberField
					path="vehicle.annualMileage"
					label="Estimated annual mileage"
					required
					value={vehicle?.annualMileage}
					error={errors["vehicle.annualMileage"]}
					onChange={(v) => setField("vehicle", "annualMileage", v)}
				/>
				<SelectField
					path="vehicle.ownership"
					label="Ownership status"
					required
					value={vehicle?.ownership}
					options={OWNERSHIP_STATUSES}
					error={errors["vehicle.ownership"]}
					onChange={(v) => setField("vehicle", "ownership", v)}
				/>
			</Section>

			<Section title="Coverage">
				<SelectField
					path="coverage.liabilityLimit"
					label={`Liability limit (min ${minLiabilityFor(applicant?.garagingState)})`}
					required
					value={coverage?.liabilityLimit}
					options={allowedLiabilityLimitsFor(applicant?.garagingState)}
					error={errors["coverage.liabilityLimit"]}
					onChange={(v) => setField("coverage", "liabilityLimit", v)}
				/>
				<SelectField
					path="coverage.collisionDeductible"
					label="Collision deductible"
					required
					value={coverage?.collisionDeductible}
					options={DEDUCTIBLES}
					error={errors["coverage.collisionDeductible"]}
					onChange={(v) => setField("coverage", "collisionDeductible", v)}
				/>
				<Box alignSelf="end">
					<SwitchField
						path="coverage.roadsideAssistance"
						label="Roadside assistance"
						checked={coverage?.roadsideAssistance ?? false}
						onChange={(v) => setField("coverage", "roadsideAssistance", v)}
					/>
				</Box>
			</Section>

			<Section title="Claims history">
				<NumberField
					path="claims.atFaultClaims"
					label="At-fault claims (past 5 years)"
					required
					value={claims?.atFaultClaims}
					error={errors["claims.atFaultClaims"]}
					onChange={(v) => {
						setField("claims", "atFaultClaims", v);

						if (v === 0) {
							setField("claims", "mostRecentClaimDate", undefined);
						}
					}}
				/>
				<TextField
					path="claims.mostRecentClaimDate"
					label="Most recent claim date"
					type="date"
					required={(claims?.atFaultClaims ?? 0) > 0}
					disabled={noClaims}
					value={claims?.mostRecentClaimDate}
					error={errors["claims.mostRecentClaimDate"]}
					onChange={(v) => setField("claims", "mostRecentClaimDate", v)}
				/>
			</Section>
		</Stack>
	);
}
