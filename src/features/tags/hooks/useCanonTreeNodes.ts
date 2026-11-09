import { useQuery } from "@tanstack/react-query";
import { QK } from "../../../lib/queryKeys";
import { getCanonTree, type TreeNode } from "../lib/canonicalize";

/** The bundled and user tree nodes, with the read's error and refetch for views to report. */
export function useCanonTreeNodes() {
  return useQuery({
    queryKey: QK.canonTreeNodes(),
    queryFn: async (): Promise<TreeNode[]> => (await getCanonTree()).nodes,
  });
}
