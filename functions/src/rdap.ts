const MS_PER_YEAR = 1000 * 60 * 60 * 24 * 365.25;

export function getRdapUrl(domain: string): string {
  const tld = domain.split(".").pop()?.toLowerCase();
  if (tld === "com") {
    return `https://rdap.verisign.com/com/v1/domain/${domain}`;
  } else if (tld === "net") {
    return `https://rdap.verisign.com/net/v1/domain/${domain}`;
  } else {
    return `https://rdap.iana.org/domain/${domain}`;
  }
}

export function computeDomainAge(registrationDate: string, now: Date = new Date()): number {
  const regTime = new Date(registrationDate).getTime();
  return Math.floor((now.getTime() - regTime) / MS_PER_YEAR);
}

export interface DomainInfo {
  ageYears: number | null;
  isExpired: boolean;
}

export async function lookupDomainInfo(domain: string): Promise<DomainInfo> {
  try {
    const url = getRdapUrl(domain);
    const response = await fetch(url);
    if (!response.ok) return { ageYears: null, isExpired: false };

    const data = await response.json() as { events?: { eventAction: string; eventDate: string }[] };
    const events = data.events ?? [];

    const registrationEvent = events.find((e) => e.eventAction === "registration");
    const expirationEvent = events.find((e) => e.eventAction === "expiration");

    const ageYears = registrationEvent?.eventDate
      ? computeDomainAge(registrationEvent.eventDate)
      : null;

    const isExpired = expirationEvent?.eventDate
      ? new Date(expirationEvent.eventDate).getTime() < Date.now()
      : false;

    return { ageYears, isExpired };
  } catch {
    return { ageYears: null, isExpired: false };
  }
}

/** @deprecated Use lookupDomainInfo instead */
export async function lookupDomainAge(domain: string): Promise<number | null> {
  const info = await lookupDomainInfo(domain);
  return info.ageYears;
}
