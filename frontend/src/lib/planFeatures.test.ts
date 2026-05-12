import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  getPlanFeatures,
  canSaveLeads,
  canGenerateScripts,
  type PlanConfig,
} from "./planFeatures";

// Test fixtures — mirrors the seed data in functions/src/seedPlans.ts
const PLAN_CONFIGS: Record<string, PlanConfig> = {
  free:     { id: "free",     name: "Free",     priceUsdCents: 0,    annualPriceUsdCents: null,  stripePriceId: null,  stripePriceIdAnnual: null,  canSaveLeads: false, canGenerateScripts: false, features: [], sortOrder: 0, active: true },
  soloPro:  { id: "soloPro",  name: "SoloPro",  priceUsdCents: 1900, annualPriceUsdCents: 15200, stripePriceId: "p_1", stripePriceIdAnnual: "p_1a", canSaveLeads: true,  canGenerateScripts: false, features: [], sortOrder: 1, active: true },
  agency:   { id: "agency",   name: "Agency",   priceUsdCents: 4900, annualPriceUsdCents: 39200, stripePriceId: "p_2", stripePriceIdAnnual: "p_2a", canSaveLeads: true,  canGenerateScripts: true,  features: [], sortOrder: 2, active: true },
  pro:      { id: "pro",      name: "Pro",      priceUsdCents: 9900, annualPriceUsdCents: 79200, stripePriceId: "p_3", stripePriceIdAnnual: "p_3a", canSaveLeads: true,  canGenerateScripts: true,  features: [], sortOrder: 3, active: true },
};

const allConfigs = Object.values(PLAN_CONFIGS);

// Unit tests

describe("getPlanFeatures", () => {
  it("returns correct features for free plan", () => {
    expect(getPlanFeatures(PLAN_CONFIGS.free)).toEqual({ canSaveLeads: false, canGenerateScripts: false });
  });

  it("returns correct features for soloPro plan", () => {
    expect(getPlanFeatures(PLAN_CONFIGS.soloPro)).toEqual({ canSaveLeads: true, canGenerateScripts: false });
  });

  it("returns correct features for agency plan", () => {
    expect(getPlanFeatures(PLAN_CONFIGS.agency)).toEqual({ canSaveLeads: true, canGenerateScripts: true });
  });

  it("returns correct features for pro plan", () => {
    expect(getPlanFeatures(PLAN_CONFIGS.pro)).toEqual({ canSaveLeads: true, canGenerateScripts: true });
  });
});

describe("canSaveLeads", () => {
  it("returns false for free plan", () => expect(canSaveLeads(PLAN_CONFIGS.free)).toBe(false));
  it("returns true for soloPro plan", () => expect(canSaveLeads(PLAN_CONFIGS.soloPro)).toBe(true));
  it("returns true for agency plan",  () => expect(canSaveLeads(PLAN_CONFIGS.agency)).toBe(true));
  it("returns true for pro plan",     () => expect(canSaveLeads(PLAN_CONFIGS.pro)).toBe(true));
});

describe("canGenerateScripts", () => {
  it("returns false for free plan",    () => expect(canGenerateScripts(PLAN_CONFIGS.free)).toBe(false));
  it("returns false for soloPro plan", () => expect(canGenerateScripts(PLAN_CONFIGS.soloPro)).toBe(false));
  it("returns true for agency plan",   () => expect(canGenerateScripts(PLAN_CONFIGS.agency)).toBe(true));
  it("returns true for pro plan",      () => expect(canGenerateScripts(PLAN_CONFIGS.pro)).toBe(true));
});

// Property-based tests

/**
 * P2: Plan Feature Gating — Feature flags are deterministic and consistent with plan hierarchy
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */
describe("P2: getPlanFeatures — feature flags are deterministic and consistent with plan hierarchy", () => {
  it("feature flags match plan hierarchy for all plans", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allConfigs),
        (config) => {
          const features = getPlanFeatures(config);
          if (config.id === "free")    return !features.canSaveLeads && !features.canGenerateScripts;
          if (config.id === "soloPro") return features.canSaveLeads && !features.canGenerateScripts;
          return features.canSaveLeads && features.canGenerateScripts;
        }
      )
    );
  });

  it("canSaveLeads is true iff plan is not free", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allConfigs),
        (config) => canSaveLeads(config) === (config.id !== "free")
      )
    );
  });

  it("canGenerateScripts is true iff plan is agency or pro", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allConfigs),
        (config) => canGenerateScripts(config) === (config.id === "agency" || config.id === "pro")
      )
    );
  });

  it("getPlanFeatures.canSaveLeads is consistent with canSaveLeads helper", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allConfigs),
        (config) => getPlanFeatures(config).canSaveLeads === canSaveLeads(config)
      )
    );
  });

  it("getPlanFeatures.canGenerateScripts is consistent with canGenerateScripts helper", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allConfigs),
        (config) => getPlanFeatures(config).canGenerateScripts === canGenerateScripts(config)
      )
    );
  });
});
