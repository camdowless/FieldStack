import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Suggestion {
  displayName: string;
  shortName: string; // city + state or zip
  lat: number;
  lng: number;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    postcode?: string;
    state?: string;
    county?: string;
  };
}

function buildShortName(r: NominatimResult): string {
  const a = r.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.county ?? "";
  const state = a.state ?? "";
  const zip = a.postcode ?? "";
  if (zip && city) return `${city}, ${state} ${zip}`.trim();
  if (city && state) return `${city}, ${state}`;
  if (zip) return zip;
  return r.display_name.split(",").slice(0, 2).join(",").trim();
}

async function fetchSuggestions(query: string): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "6",
    countrycodes: "us",
    addressdetails: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as NominatimResult[];
  return data.map((r) => ({
    displayName: r.display_name,
    shortName: buildShortName(r),
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  }));
}

interface LocationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onValidLocation?: (valid: boolean) => void;
  className?: string;
  inputClassName?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function LocationAutocomplete({
  value,
  onChange,
  onValidLocation,
  className,
  inputClassName,
  onKeyDown,
}: LocationAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync external value resets (e.g. "New Search")
  useEffect(() => {
    if (value === "") {
      setInputValue("");
      setIsValid(false);
      setSuggestions([]);
    }
  }, [value]);

  const markValid = useCallback((valid: boolean) => {
    setIsValid(valid);
    onValidLocation?.(valid);
  }, [onValidLocation]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    onChange(v);
    markValid(false);
    setHighlightIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (v.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await fetchSuggestions(v.trim());
      setLoading(false);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 350);
  };

  const selectSuggestion = (s: Suggestion) => {
    setInputValue(s.shortName);
    onChange(s.shortName);
    markValid(true);
    setSuggestions([]);
    setOpen(false);
    setHighlightIndex(-1);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (highlightIndex >= 0 && suggestions[highlightIndex]) {
        e.preventDefault();
        selectSuggestion(suggestions[highlightIndex]);
      } else if (suggestions.length === 1) {
        e.preventDefault();
        selectSuggestion(suggestions[0]);
      } else {
        onKeyDown?.(e);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    } else {
      onKeyDown?.(e);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
      {loading && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin pointer-events-none" />
      )}
      {!loading && isValid && (
        <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-500 pointer-events-none" />
      )}
      <Input
        placeholder="Zip code or city, state"
        className={cn("pl-10", (loading || isValid) && "pr-9", inputClassName)}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls="location-listbox"
      />
      {open && suggestions.length > 0 && (
        <div
          ref={listRef}
          id="location-listbox"
          role="listbox"
          className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto"
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.lat}-${s.lng}`}
              type="button"
              role="option"
              aria-selected={i === highlightIndex}
              className={cn(
                "w-full text-left px-3 py-2 text-sm flex items-start gap-2 transition-colors",
                i === highlightIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(s);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium truncate">{s.shortName}</p>
                <p className="text-xs text-muted-foreground truncate">{s.displayName}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
