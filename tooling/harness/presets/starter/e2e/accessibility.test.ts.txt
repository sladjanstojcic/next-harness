import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the home page has no accessibility violations", async ({ page }) => {
  await page.goto("/");
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations).toEqual([]);
});
