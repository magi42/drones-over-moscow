import { expect, test } from '@playwright/test'

test('operator can select a route, launch, and reach results', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: /accept mission/i }).click({ timeout: 5000 })
  await expect(page.getByRole('heading', { name: /select launch corridor/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /estonia pine needle/i })).toBeDisabled()
  await page.getByRole('button', { name: /ukraine sunflower/i }).click()
  await expect(page.getByRole('heading', { name: 'Ukraine' })).toBeVisible()
  await page.getByRole('button', { name: /launch formation/i }).click()
  await expect(page.getByText(/formation control/i)).toBeVisible({
    timeout: 15_000,
  })
  await page.evaluate(() => {
    window.__DOM_GAME__?.getState().finishRun(true)
  })
  await expect(page.getByRole('heading', { name: /formation extracted/i })).toBeVisible()
  await expect(page.getByText(/drones recovered/i)).toBeVisible()
})
