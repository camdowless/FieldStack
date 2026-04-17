import { useState, useRef, useEffect } from "react";
import { allCategories } from "@/data/mockBusinesses";
import { Input } from "@/components/ui/input";
import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const ref = useRef<HTMLDivElement>(null);

  const filtered = value && value !== "all"
    ? allCategories.filter((c) => c.toLowerCase().includes(value.toLowerCase()))
    : allCategories;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        placeholder={placeholder}
        className={cn("pl-9", inputClassName)}
        value={value === "all" ? "" : value}
        onChange={(e) => {
          onChange(e.target.value || "all");
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md max-h-48 overflow-y-auto">
          {filtered.map((cat) => (
            <button
              key={cat}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(cat);
                setOpen(false);
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
