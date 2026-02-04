import { describe, expect, it } from "vitest";
import { corePlaceholder } from "./index";

describe("corePlaceholder", () => {
  it("returns the core label", () => {
    expect(corePlaceholder()).toBe("core");
  });
});
