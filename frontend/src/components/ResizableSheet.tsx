import { useRef, useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const DEFAULT_WIDTH = 672; // ~sm:max-w-2xl

interface ResizableSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function ResizableSheet({ open, onOpenChange, title, description, children }: ResizableSheetProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(next);
    };
    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="p-0 transition-none"
        style={{ width, maxWidth: "100vw" }}
      >
        {/* Drag handle on the left edge */}
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize z-50 group hover:bg-primary/20 transition-colors"
          aria-hidden="true"
        >
          {/* Visual grip dots */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-muted-foreground/60" />
            ))}
          </div>
        </div>

        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>

        <ScrollArea className="h-full">
          <div className="p-6">{children}</div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
