# Gloria Bae – offline tuck-shop stock manager

An offline Android app (PWA) for a grocery tuck shop: add products, record sales (stock goes down automatically), restock, and see monthly sales and low-stock items (anything **below 5**) on the dashboard.

## Files
| File | Purpose |
|---|---|
| `index.html` | App page |
| `app.js` | All app logic (IndexedDB storage on the phone) |
| `styles.css` | Look & feel (burgundy / gold) |
| `library.js` | Seed library of 538 product names from the Rushmoor lists (names only, not stock) |
| `manifest.json` | App name, colours, icons (needed by PWABuilder) |
| `sw.js` | Service worker – makes the app work with no internet |
| `icons/` | App icons made from Gloria's photo (normal + maskable) |

## 1. Put it on GitHub Pages
1. Create a new **public** repository on GitHub, e.g. `gloria-bae`.
2. Upload **all files and the `icons` folder** to the root of the repo (Add file → Upload files).
3. Go to **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/gloria-bae/`. Open it once in Chrome on the phone to check.

## 2. Make the Android app with PWABuilder
1. Go to **https://www.pwabuilder.com** and paste your GitHub Pages URL.
2. It should pass Manifest, Service Worker and Security checks.
3. Click **Package for stores → Android → Generate Package**.
   - Package ID e.g. `com.gloriabae.app`, App name `Gloria Bae`.
   - For direct install (no Play Store) download the package and install the **.apk** on the phone (allow "Install unknown apps").
   - For the Play Store use the **.aab**, and upload the generated `assetlinks.json` to `/.well-known/assetlinks.json` in the repo so the address bar is hidden.
4. **Keep the signing key file and passwords PWABuilder gives you** – you need them for every future update.

## Using the app
- **Stock tab → +**: add a product. Start typing the name and suggestions appear from the library. Every new name you add is saved to the library automatically.
- **Sell tab**: tap products to build a sale, adjust quantities, **Record sale**. Stock is reduced and the sale is logged. You can't sell more than is in stock.
- **Restock**: tap a product (or the Restock button on the dashboard) and enter the quantity received.
- **Sales tab**: sales by month, grouped by day. Tap a sale to void it (stock is returned).
- **More tab**: manage the name library, change shop name / currency / low-stock level, **back up and restore**, and export Sales or Stock CSV.

## Important
All data is stored **only on the phone**. Clearing Chrome/app data or uninstalling deletes it. Use **More → Backup data** regularly and keep the file safe (e.g. send it to yourself on WhatsApp or save it to Google Drive).

When you change the code later, bump `CACHE` in `sw.js` (e.g. `gloria-bae-v2`) so phones pick up the new version.
