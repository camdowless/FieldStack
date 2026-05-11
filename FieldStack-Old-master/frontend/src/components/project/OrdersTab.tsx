import { useState } from "react";
import { Package, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useUpdateOrderItem } from "@/hooks/useOrderItem";
import { useToast } from "@/hooks/use-toast";
import type { OrderItemDoc } from "@/hooks/useProjectDetail";
import type { OrderStatus } from "@/lib/fieldstackApi";

const STATUS_LABELS: Record<OrderStatus, string> = {
  NOT_ORDERED: "Not ordered",
  ORDERED: "Ordered",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANTS: Record<OrderStatus, string> = {
  NOT_ORDERED: "bg-muted text-muted-foreground",
  ORDERED: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  IN_TRANSIT: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
};

const ITEM_TYPE_LABELS: Record<string, string> = {
  CABINETS_STANDARD: "Cabinets (standard)",
  CABINETS_CUSTOM: "Cabinets (custom)",
  COUNTERTOPS: "Countertops",
  HARDWARE: "Hardware",
};

interface OrdersTabProps {
  orderItems: OrderItemDoc[];
  projectId: string;
}

function OrderRow({ item, projectId }: { item: OrderItemDoc; projectId: string }) {
  const [open, setOpen] = useState(false);
  const [po, setPo] = useState(item.poNumber ?? "");
  const [vendor, setVendor] = useState(item.vendorName ?? "");
  const { mutate, isPending } = useUpdateOrderItem(projectId);
  const { toast } = useToast();

  const handleStatusChange = (status: OrderStatus) => {
    mutate(
      { orderItemId: item.id, data: { status } },
      {
        onError: (err) => toast({
          title: "Update failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        }),
      }
    );
  };

  const handleSaveDetails = () => {
    mutate(
      { orderItemId: item.id, data: { poNumber: po, vendorName: vendor } },
      {
        onSuccess: () => { setOpen(false); toast({ title: "Order updated" }); },
        onError: (err) => toast({
          title: "Update failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        }),
      }
    );
  };

  const orderByDate = new Date(item.orderByDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const installDate = new Date(item.gcInstallDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const location = [item.building, item.floor].filter(Boolean).join(" – ");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border bg-card">
        <CollapsibleTrigger className="w-full" asChild>
          <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-lg">
            <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}</span>
                {location && <span className="text-xs text-muted-foreground">— {location}</span>}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                <span>Order by: {orderByDate}</span>
                <span>Install: {installDate}</span>
                {item.poNumber && <span>PO: {item.poNumber}</span>}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Select value={item.status} onValueChange={(v) => handleStatusChange(v as OrderStatus)} disabled={isPending}>
                <SelectTrigger className="h-7 w-[120px] text-xs" onClick={(e) => e.stopPropagation()}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v} className="text-xs">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium hidden sm:inline ${STATUS_VARIANTS[item.status]}`}>
                {STATUS_LABELS[item.status]}
              </span>
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-1 border-t flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">PO number</label>
                <Input value={po} onChange={(e) => setPo(e.target.value)} placeholder="PO-12345" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vendor</label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor name" className="h-8 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={isPending}>Cancel</Button>
              <Button size="sm" onClick={handleSaveDetails} disabled={isPending}>Save</Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function OrdersTab({ orderItems, projectId }: OrdersTabProps) {
  if (orderItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Package className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No order items yet. Upload a schedule to generate orders.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {orderItems.map((item) => (
        <OrderRow key={item.id} item={item} projectId={projectId} />
      ))}
    </div>
  );
}
