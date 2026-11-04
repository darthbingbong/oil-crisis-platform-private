p = "e2e/vessels.mjs"
s = open(p, encoding="utf-8", newline="").read()
crlf = "\r\n" in s
s = s.replace("\r\n", "\n")
old = '''await page.locator('[data-testid="vessel-mode-ais"]').click();
await page.waitForFunction(() => document.querySelector('[data-testid="vessel-note"]')?.textContent?.includes("unavailable"), null, { timeout: 15000 });
console.log("D. AIS mode, no key:", await txt("vessel-note"), "| badge:", await txt("vessel-badge"));'''
new = '''// after M15: with no AISStream key the live-feed toggle is disabled and explained (it used to be pressable and then show an error)
await page.waitForFunction(() => document.querySelector('[data-testid="vessel-feed-explain"]'), null, { timeout: 15000 });
console.log("D. AISStream not configured:", await txt("vessel-feed-explain"), "| toggle disabled:", await page.locator('[data-testid="vessel-mode-ais"]').isDisabled(), "| badge:", await txt("vessel-badge"));'''
assert old in s
s = s.replace(old, new)
open(p, "w", encoding="utf-8", newline="").write(s.replace("\n", "\r\n") if crlf else s)
print("ok")
