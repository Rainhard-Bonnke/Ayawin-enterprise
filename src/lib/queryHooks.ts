import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationFunction,
  type QueryFunction,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";

export const EMPTY_ARRAY: never[] = Object.freeze([]) as unknown as never[];

type QueryOptions<TData> = Omit<UseQueryOptions<TData, Error, TData>, "queryKey" | "queryFn">;

/** Shared, typed list query. TanStack Query's AbortSignal reaches the API request. */
export function useList<TData>(
  queryKey: QueryKey,
  queryFn: QueryFunction<TData, QueryKey>,
  options: QueryOptions<TData> = {},
) {
  return useQuery<TData, Error, TData, QueryKey>({ queryKey, queryFn, ...options });
}

/** Shared, typed document query. Use `enabled` while its document id is unknown. */
export function useDocument<TData>(
  queryKey: QueryKey,
  queryFn: QueryFunction<TData, QueryKey>,
  options: QueryOptions<TData> = {},
) {
  return useQuery<TData, Error, TData, QueryKey>({ queryKey, queryFn, ...options });
}

type ActionOptions<TData, TVariables, TContext> = Omit<
  UseMutationOptions<TData, Error, TVariables, TContext>,
  "mutationFn" | "onSuccess"
> & {
  mutationFn: MutationFunction<TData, TVariables>;
  invalidate?: QueryKey[];
  onSuccess?: UseMutationOptions<TData, Error, TVariables, TContext>["onSuccess"];
};

/** Shared mutation hook. Successful actions invalidate all related query keys. */
export function useAction<TData, TVariables, TContext = unknown>(
  options: ActionOptions<TData, TVariables, TContext>,
) {
  const queryClient = useQueryClient();
  const { mutationFn, invalidate = [], onSuccess, ...mutationOptions } = options;
  return useMutation<TData, Error, TVariables, TContext>({
    ...mutationOptions,
    mutationFn,
    onSuccess: async (data, variables, context, mutation) => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      await onSuccess?.(data, variables, context, mutation);
    },
  });
}
