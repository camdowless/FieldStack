import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateOrderItem, type UpdateOrderItemInput } from "@/lib/fieldstackApi";

export function useUpdateOrderItem(projectId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderItemId,
      data,
    }: {
      orderItemId: string;
      data: UpdateOrderItemInput;
    }) => updateOrderItem(orderItemId, projectId, data),
    onSuccess: () => {
      // Alert counts depend on order status — invalidate both
      qc.invalidateQueries({ queryKey: ["project-alerts", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
