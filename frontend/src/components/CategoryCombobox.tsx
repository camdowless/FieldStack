import { useState, useRef, useEffect, useMemo } from "react";
import { DFS_CATEGORIES, formatCategoryLabel, toCategoryApiKey } from "@/data/dfsCategories";
import { Input } from "@/components/ui/input";
import { SlidersHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Pre-build a lookup set + display list once at module level. */
const CATEGORY_LIST = DFS_CATEGORIES.map(([key, count]) => ({
  apiKey: key,
  label: formatCategoryLabel(key),
  labelLower: formatCategoryLabel(key).toLowerCase(),
  count,
}));
const VALID_KEYS = new Set(DFS_CATEGORIES.map(([k]) => k));

const MAX_SUGGESTIONS = 50;

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface CategoryComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export function CategoryCombobox({
  value,
  onChange,
  className,
  inputClassName,
  placeholder = "Category (e.g. Landscaper)",
  onKeyDown,
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync inputValue when external value changes (e.g. reset)
  useEffect(() => {
    if (value === "all" || !value) {
      setInputValue("");
    } else if (VALID_KEYS.has(value)) {
      setInputValue(formatCategoryLabel(value));
    }
  }, [value]);

  // Filter categories based on input — show after 1+ chars
  const filtered = useMemo(() => {
    if (inputValue.length < 1) return [];
    const q = inputValue.toLowerCase();
    const matches = CATEGORY_LIST.filter((c) => c.labelLower.includes(q));
    // Sort: starts-with first, then by business count descending
    matches.sort((a, b) => {
      const aStarts = a.labelLower.startsWith(q) ? 0 : 1;
      const bStarts = b.labelLower.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return b.count - a.count;
    });
    return matches.slice(0, MAX_SUGGESTIONS);
  }, [inputValue]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        // On blur, validate: if current input doesn't match a valid category, clear it
        validateAndCommit();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, value]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex]);

  const selectCategory = (apiKey: string) => {
    setInputValue(formatCategoryLabel(apiKey));
    onChange(apiKey);
    setOpen(false);
    setHighlightIndex(-1);
  };

  const validateAndCommit = () => {
    if (!inputValue.trim()) {
      onChange("all");
      return;
    }
    // Check if current input exactly matches a category label
    const apiKey = toCategoryApiKey(inputValue);
    if (VALID_KEYS.has(apiKey)) {
      onChange(apiKey);
      return;
    }
    // Check for exact label match (case-insensitive)
    const match = CATEGORY_LIST.find((c) => c.labelLower === inputValue.toLowerCase());
    if (match) {
      setInputValue(match.label);
      onChange(match.apiKey);
      return;
    }
    // No match — if there's exactly one filtered result, auto-select it
    if (filtered.length === 1) {
      setInputValue(filtered[0].label);
      onChange(filtered[0].apiKey);
      return;
    }
    // Invalid — revert to previous valid value or clear
    if (value && value !== "all" && VALID_KEYS.has(value)) {
      setInputValue(formatCategoryLabel(value));
    } else {
      setInputValue("");
      onChange("all");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (highlightIndex >= 0 && filtered[highlightIndex]) {
        e.preventDefault();
        selectCategory(filtered[highlightIndex].apiKey);
      } else if (filtered.length === 1) {
        e.preventDefault();
        selectCategory(filtered[0].apiKey);
      } else {
        // Let parent handle Enter (trigger search) only if we have a valid category
        validateAndCommit();
        onKeyDown?.(e);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      validateAndCommit();
    } else if (e.key === "Tab") {
      // Auto-complete on Tab if there's a highlighted or single match
      if (highlightIndex >= 0 && filtered[highlightIndex]) {
        selectCategory(filtered[highlightIndex].apiKey);
      } else if (filtered.length === 1) {
        selectCategory(filtered[0].apiKey);
      } else {
        validateAndCommit();
      }
    } else {
      onKeyDown?.(e);
    }
  };

  const isValid = !inputValue.trim() || VALID_KEYS.has(value) || VALID_KEYS.has(toCategoryApiKey(inputValue));

  return (
    <div ref={ref} className={cn("relative", className)}>
      <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      {value && value !== "all" && VALID_KEYS.has(value) && (
        <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-500 pointer-events-none" />
      )}
      <Input
        placeholder={placeholder}
        className={cn(
          "pl-9",
          value && value !== "all" && VALID_KEYS.has(value) && "pr-9",
          !isValid && "border-destructive focus-visible:ring-destructive",
          inputClassName,
        )}
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          setHighlightIndex(-1);
          setOpen(true);
          // If they clear the input, reset
          if (!e.target.value.trim()) {
            onChange("all");
          }
        }}
        onFocus={() => {
          if (inputValue.length >= 1) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && filtered.length > 0}
        aria-autocomplete="list"
        aria-controls="category-listbox"
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          id="category-listbox"
          role="listbox"
          className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md max-h-60 overflow-y-auto"
        >
          {filtered.map((cat, i) => (
            <button
              key={cat.apiKey}
              type="button"
              role="option"
              aria-selected={i === highlightIndex}
              className={cn(
                "w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors",
                i === highlightIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                selectCategory(cat.apiKey);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              <span className="truncate">{cat.label}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatCount(cat.count)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
