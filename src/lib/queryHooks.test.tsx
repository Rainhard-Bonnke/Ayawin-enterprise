// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useAction, useList } from "./queryHooks";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("shared query hooks", () => {
  it("loads typed data and invalidates the list after a successful action", async () => {
    let value = "before";
    let listRequests = 0;
    server.use(
      http.get("http://localhost/api/v1/test-records", () => {
        listRequests += 1;
        return HttpResponse.json({ value });
      }),
      http.post("http://localhost/api/v1/test-records", async () => {
        value = "after";
        return HttpResponse.json({ saved: true });
      }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = createWrapper(client);
    const { result } = renderHook(
      () => {
        const list = useList(["test-records"], async ({ signal }) => {
          const response = await fetch("http://localhost/api/v1/test-records", { signal });
          return (await response.json()) as { value: string };
        });
        const save = useAction({
          mutationFn: async (_input: void) => {
            const response = await fetch("http://localhost/api/v1/test-records", {
              method: "POST",
            });
            return (await response.json()) as { saved: boolean };
          },
          invalidate: [["test-records"]],
        });
        return { list, save };
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.list.data?.value).toBe("before"));
    await act(async () => {
      await result.current.save.mutateAsync(undefined);
    });
    await waitFor(() => expect(result.current.list.data?.value).toBe("after"));
    expect(result.current.save.data?.saved).toBe(true);
    expect(listRequests).toBeGreaterThanOrEqual(2);
    client.clear();
  });
});
