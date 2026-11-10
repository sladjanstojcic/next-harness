import { expect, test } from "vitest";
import { toUserMessage, UserError } from "./user-error";

test("passes a UserError message through", () => {
  expect(toUserMessage(new UserError("Name is taken."))).toBe("Name is taken.");
});

test("hides an unexpected error message", () => {
  expect(toUserMessage(new Error("db down"))).toBe("Something went wrong.");
});

test.each([null, "db down", { message: "private details" }])("hides non-Error values: %j", (error) => {
  expect(toUserMessage(error)).toBe("Something went wrong.");
});
