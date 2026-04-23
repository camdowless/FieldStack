import type { Business } from "@/data/mockBusinesses";

// Module-level cache of the latest search results.
// Keyed by business.id (CID). Survives navigation but not page refresh.
// LeadDetail reads from here; Index writes to it after each search.

const cache = new Map<string, Business>();

export function setSearchResults(businesses: Business[]): void {
  cache.clear();
  for (const b of businesses) {
    cache.set(b.id, b);
  }
}

export function getBusinessById(id: string): Business | undefined {
  return cache.get(id);
}

export function getAllCachedBusinesses(): Business[] {
  return [...cache.values()];
}

export function updateCachedBusiness(business: Business): void {
  if (cache.has(business.id)) {
    cache.set(business.id, business);
  }
}
