import { expect, test } from "@playwright/test"

test("loads under the GitHub Pages base and obfuscates input", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Prometheus Web" })).toBeVisible()

  const input = page.getByLabel("Lua input").locator(".cm-content")
  await input.click()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await page.keyboard.type('print("Hello from Playwright")')

  await page.getByRole("button", { name: "Obfuscate" }).click()
  await expect(page.getByText("Obfuscation complete")).toBeVisible({ timeout: 30000 })
  await expect(page.getByLabel("Obfuscated output")).toContainText("print")

  await page.getByRole("button", { name: "Copy output" }).click()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "Download output" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe("prometheus.obfuscated.lua")
})

test("runs input script and shows logs", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Prometheus Web" })).toBeVisible()

  const input = page.getByLabel("Lua input").locator(".cm-content")
  await input.click()
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await page.keyboard.type('print("Run works")')

  await page.getByLabel("Lua input").getByRole("button", { name: "Run" }).click()
  await expect(page.getByText("Script execution complete")).toBeVisible({ timeout: 30000 })
  await expect(page.getByText("Run works")).toBeVisible()
})
