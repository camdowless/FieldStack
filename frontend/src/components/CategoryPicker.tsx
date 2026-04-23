import { useState, useMemo } from "react";
import { DFS_CATEGORIES, formatCategoryLabel, toCategoryApiKey } from "@/data/dfsCategories";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, ChevronRight, X, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Bundles ────────────────────────────────────────────────────────────────────

interface Bundle {
  id: string;
  label: string;
  emoji: string;
  description: string;
  /** API keys that belong to this bundle */
  keys: string[];
  /** The single API key sent to the search when the whole bundle is selected */
  searchKey: string;
}

export const BUNDLES: Bundle[] = [
  {
    id: "home_services",
    label: "Home Services",
    emoji: "🏠",
    description: "Contractors, HVAC, plumbing, electrical & more",
    searchKey: "contractor",  // broad DFS category covering home service trades
    keys: [
      "contractor", "general_contractor", "hvac_contractor", "plumber",
      "electrician", "roofing_contractor", "landscaper", "handyman",
      "painter", "carpenter", "flooring_contractor", "concrete_contractor",
      "masonry_contractor", "fence_contractor", "tree_service", "lawn_care_service",
      "house_cleaning_service", "window_installation_service", "bathroom_remodeler",
      "kitchen_remodeler", "remodeler", "home_builder", "custom_home_builder",
      "insulation_contractor", "siding_contractor", "tile_contractor",
      "dry_wall_contractor", "pest_control_service", "pressure_washing_service",
      "carpet_cleaning_service", "janitorial_service", "cleaning_service",
    ],
  },
  {
    id: "auto",
    label: "Auto Services",
    emoji: "🚗",
    description: "Repair shops, body shops, detailing & more",
    searchKey: "auto_repair_shop",
    keys: [
      "auto_repair_shop", "car_repair", "auto_body_shop", "mechanic",
      "tire_shop", "oil_change_service", "car_wash", "car_detailing_service",
      "auto_glass_shop", "brake_shop", "wheel_alignment_service",
      "auto_electrical_service", "truck_repair_shop",
    ],
  },
  {
    id: "health_wellness",
    label: "Health & Wellness",
    emoji: "💊",
    description: "Doctors, dentists, chiropractors, therapists & more",
    searchKey: "medical_clinic",
    keys: [
      "doctor", "dentist", "dental_clinic", "chiropractor", "physiotherapist",
      "massage_therapist", "optometrist", "veterinarian", "psychologist",
      "counselor", "nutritionist", "personal_trainer", "yoga_studio",
      "gym", "fitness_center", "acupuncture_clinic", "mental_health_service",
      "pediatrician", "dermatologist", "orthodontist",
    ],
  },
  {
    id: "insurance_finance",
    label: "Insurance & Finance",
    emoji: "📋",
    description: "Insurance agencies, financial advisors, accountants",
    searchKey: "insurance_agency",
    keys: [
      "insurance_agency", "auto_insurance_agency", "life_insurance_agency",
      "home_insurance_agency", "insurance_broker", "financial_planner",
      "financial_consultant", "accountant", "accounting_firm",
      "certified_public_accountant", "mortgage_broker", "mortgage_lender",
      "tax_preparation_service", "bookkeeping_service",
    ],
  },
  {
    id: "real_estate",
    label: "Real Estate",
    emoji: "🏡",
    description: "Agents, property managers, appraisers",
    searchKey: "real_estate_agency",
    keys: [
      "real_estate_agency", "real_estate_agents", "real_estate_consultant",
      "property_management_company", "real_estate_developer",
      "real_estate_appraiser", "commercial_real_estate_agency",
      "real_estate_rental_agency", "home_inspector",
    ],
  },
  {
    id: "restaurants_food",
    label: "Restaurants & Food",
    emoji: "🍽️",
    description: "Restaurants, cafes, bakeries, food trucks",
    searchKey: "restaurant",
    keys: [
      "restaurant", "fast_food_restaurant", "cafe", "coffee_shop", "bakery",
      "pizza_restaurant", "bar_and_grill", "diner", "food_court",
      "catering_service", "meal_delivery",
    ],
  },
  {
    id: "beauty_personal",
    label: "Beauty & Personal Care",
    emoji: "💅",
    description: "Salons, spas, barbers, nail studios",
    searchKey: "beauty_salon",
    keys: [
      "beauty_salon", "hair_salon", "nail_salon", "barber_shop", "spa",
      "massage_spa", "facial_spa", "eyelash_salon", "tanning_studio",
      "waxing_hair_removal_service", "tattoo_shop", "makeup_artist",
    ],
  },
  {
    id: "professional_services",
    label: "Professional Services",
    emoji: "💼",
    description: "Lawyers, consultants, marketing, IT",
    searchKey: "consultant",
    keys: [
      "lawyer", "law_firm", "consultant", "marketing_agency",
      "advertising_agency", "graphic_designer", "website_designer",
      "internet_marketing_service", "computer_repair_service",
      "it_support", "security_service", "photographer",
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const CATEGORY_LIST = DFS_CATEGORIES.map(([key]) => ({
  apiKey: key,
  label: formatCategoryLabel(key),
  labelLower: formatCategoryLabel(key).toLowerCase(),
}));
const VALID_KEYS = new Set(DFS_CATEGORIES.map(([k]) => k));
const MAX_SEARCH_RESULTS = 40;

// ── Component ──────────────────────────────────────────────────────────────────

interface CategoryPickerProps {
  value: string; // api key or bundle id or "all"
  onChange: (value: string) => void;
  className?: string;
}

type PickerView = "bundles" | "specific";

export function CategoryPicker({ value, onChange, className }: CategoryPickerProps) {
  const [view, setView] = useState<PickerView>("bundles");
  const [searchQuery, setSearchQuery] = useState("");
  const [open, setOpen] = useState(false);

  const activeBundle = BUNDLES.find((b) => b.id === value || b.searchKey === value);
  const activeCategory = !activeBundle && value && value !== "all" && VALID_KEYS.has(value)
    ? CATEGORY_LIST.find((c) => c.apiKey === value)
    : null;

  const displayLabel = activeBundle?.label ?? activeCategory?.label ?? null;

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return CATEGORY_LIST
      .filter((c) => c.labelLower.includes(q))
      .sort((a, b) => {
        const aS = a.labelLower.startsWith(q) ? 0 : 1;
        const bS = b.labelLower.startsWith(q) ? 0 : 1;
        return aS - bS;
      })
      .slice(0, MAX_SEARCH_RESULTS);
  }, [searchQuery]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSearchQuery(v);
    if (v.trim().length > 0) setView("specific");
    else setView("bundles");
  };

  const selectBundle = (b: Bundle) => {
    onChange(b.id);
    setOpen(false);
    setSearchQuery("");
  };

  const selectCategory = (apiKey: string) => {
    onChange(apiKey);
    setOpen(false);
    setSearchQuery("");
    setView("bundles");
  };

  const clearSelection = () => {
    onChange("all");
    setSearchQuery("");
    setView("bundles");
  };

  // Resolve what key to actually send to the search API
  // (exported so Index.tsx can use it)
  return (
    <div className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full h-11 flex items-center gap-2 px-3 rounded-md border border-input bg-background text-sm text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open && "ring-2 ring-ring",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className={cn("flex-1 truncate", !displayLabel && "text-muted-foreground")}>
          {displayLabel ?? "All categories"}
        </span>
        {displayLabel ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear category"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onMouseDown={(e) => { e.stopPropagation(); clearSelection(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); clearSelection(); } }}
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : (
          <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg">
          {/* Search input */}
          <div className="p-2 border-b">
            <Input
              autoFocus
              placeholder="Search specific category…"
              value={searchQuery}
              onChange={handleSearchChange}
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filteredCategories.length === 1) {
                  selectCategory(filteredCategories[0].apiKey);
                }
              }}
            />
          </div>

          <div className="max-h-72 overflow-y-auto">
            {view === "bundles" && (
              <div className="p-1">
                <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Popular bundles
                </p>
                {BUNDLES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={cn(
                      "w-full text-left px-2 py-2 rounded-sm text-sm flex items-center gap-3 transition-colors hover:bg-accent hover:text-accent-foreground",
                      (value === b.id || value === b.searchKey) && "bg-accent/60",
                    )}
                    onClick={() => selectBundle(b)}
                  >
                    <span className="text-base shrink-0">{b.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{b.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{b.description}</p>
                    </div>
                    {(value === b.id || value === b.searchKey) && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </button>
                ))}
                <div className="border-t mt-1 pt-1">
                  <button
                    type="button"
                    className="w-full text-left px-2 py-2 rounded-sm text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    onClick={() => setView("specific")}
                  >
                    Browse all categories →
                  </button>
                </div>
              </div>
            )}

            {view === "specific" && (
              <div className="p-1">
                {searchQuery.trim() === "" && (
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setView("bundles")}
                  >
                    ← Back to bundles
                  </button>
                )}
                {filteredCategories.length === 0 && searchQuery.trim() !== "" && (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">No categories found</p>
                )}
                {filteredCategories.map((c) => (
                  <button
                    key={c.apiKey}
                    type="button"
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-sm text-sm flex items-center justify-between gap-2 transition-colors hover:bg-accent hover:text-accent-foreground",
                      value === c.apiKey && "bg-accent/60",
                    )}
                    onClick={() => selectCategory(c.apiKey)}
                  >
                    <span className="truncate">{c.label}</span>
                    {value === c.apiKey && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Resolve the category value to the single DFS API category key for the search.
 * Bundles map to their representative searchKey (a valid DFS category).
 * Specific category keys pass through as-is.
 */
export function resolveCategoryApiKey(value: string): string {
  if (!value || value === "all") return "businesses";
  const bundle = BUNDLES.find((b) => b.id === value);
  if (bundle) return bundle.searchKey;
  return value;
}
