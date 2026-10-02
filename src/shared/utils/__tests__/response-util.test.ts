import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodIssues } from "../response-util";

describe("formatZodIssues", () => {
  it("joins every issue as path: message", () => {
    const result = z
      .object({ name: z.string(), tags: z.array(z.string()) })
      .safeParse({ tags: [1] });
    expect(result.success).toBe(false);
    expect(formatZodIssues(result.error as z.ZodError)).toBe(
      "name: Required; tags.0: Expected string, received number",
    );
  });

  it("names root-level issues (root)", () => {
    const result = z.string().safeParse(1);
    expect(formatZodIssues(result.error as z.ZodError)).toBe(
      "(root): Expected string, received number",
    );
  });
});
