/**
 * Geocode a location string (city name, zip code, address) into lat/lng
 * using OpenStreetMap Nominatim (free, no API key required).
 */

interface GeoResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocodeLocation(
  location: string,
  _googleApiKey?: string | undefined,
): Promise<GeoResult> {
  const params = new URLSearchParams({
    q: location,
    format: "json",
    limit: "1",
    countrycodes: "us",
  });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        "User-Agent": "LeadScout/1.0 (lead-finder-geocoding)",
        "Accept": "application/json",
      },
    },
  );

  if (!res.ok) {
    throw new Error(`Geocoding service returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as NominatimResult[];

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Could not geocode "${location}". Try a zip code or "City, State" format.`);
  }

  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);

  if (isNaN(lat) || isNaN(lng)) {
    throw new Error(`Could not geocode "${location}". Try a zip code or "City, State" format.`);
  }

  console.log(`[geocode] "${location}" → ${lat},${lng} (${data[0].display_name})`);
  return { lat, lng, formattedAddress: data[0].display_name };
}

/** Convert miles to kilometers. */
export function milesToKm(miles: number): number {
  return miles * 1.60934;
}

/** Build the DFS location_coordinate string: "lat,lng,radius_km" */
export function buildLocationCoordinate(
  lat: number,
  lng: number,
  radiusKm: number,
): string {
  return `${lat},${lng},${radiusKm}`;
}
