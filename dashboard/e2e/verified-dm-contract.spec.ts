import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  isVerifiedDecisionMaker,
  type LeadReadinessInput,
} from "../lib/lead-readiness";

type ContractCase = {
  name: string;
  expected: boolean;
  lead: LeadReadinessInput;
};

const fixturePath = path.resolve(
  process.cwd(),
  "../tests/fixtures/verified_dm_contract.json",
);
const cases = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as ContractCase[];

test.describe("Verified decision-maker contract", () => {
  for (const contractCase of cases) {
    test(contractCase.name, () => {
      expect(isVerifiedDecisionMaker(contractCase.lead)).toBe(contractCase.expected);
    });
  }
});
