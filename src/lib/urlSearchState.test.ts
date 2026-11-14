import { describe, expect, it } from "vitest";
import { readUrlSearchParam, writeUrlSearchParam } from "./urlSearchState";

describe("URL-backed table state", () => {
  it("reads the supplied fallback when a parameter is absent", () => {
    expect(readUrlSearchParam("?status=posted", "page", "1")).toBe("1");
  });

  it("preserves other filters while updating a parameter", () => {
    expect(writeUrlSearchParam("?status=posted&page=1", "page", "2", "1")).toBe(
      "?status=posted&page=2",
    );
  });

  it("removes defaults from the URL", () => {
    expect(writeUrlSearchParam("?q=juice&page=3", "page", "1", "1")).toBe("?q=juice");
  });
});
