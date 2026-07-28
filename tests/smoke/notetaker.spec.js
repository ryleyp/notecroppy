import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";

test("approves a local vault and reaches the ready-to-generate workflow", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-smoke-"));
  const vault = path.join(root, "Vault");
  fs.mkdirSync(path.join(vault, "Customers", "Cardinal"), { recursive: true });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByPlaceholder("/Users/yourname/Documents/MyVault").fill(vault);
  await page.getByRole("button", { name: "Test Path" }).click();
  await expect(page.getByText(/Found \d+ folders in vault/)).toBeVisible();
  await page.getByRole("button", { name: "Save Settings" }).click();

  await expect(page.getByText("Destination Folder")).toBeVisible();
  await expect(page.getByRole("button", { name: "Customers", exact: true })).toBeVisible();

  await page.getByPlaceholder("e.g. 2026-06-05 - Acme Kickoff").fill("2026-05-12 - Cardinal SystemLink Sync");
  await page.getByPlaceholder("Paste your meeting transcript here...").fill(
    "Cardinal confirmed SystemLink deployment is now approved. Older IT blockers are resolved."
  );

  await expect(page.getByRole("button", { name: /Generate Meeting Notes/ })).toBeEnabled();
});
