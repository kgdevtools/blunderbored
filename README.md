# Blunderbored

A chess board you can use **offline, right in your browser** — with **Stockfish 18 Lite** for engine analysis.

## Install & run

You'll need [Node.js](https://nodejs.org) (version 20 or newer) installed.

```bash
# 1. Download the code
git clone https://github.com/kgdevtools/blunderbored.git
cd blunderbored

# 2. Install dependencies
npm install

# 3. Start it
npm run dev
```

Then open **http://localhost:3000** in your browser.

## Adding games to your library

Save any game to your personal library and reopen it whenever you like. You can
sort games into folders, and they'll still be there next time you visit.

Everything is kept **on your own device, inside your browser** — nothing is
uploaded anywhere and only you can see it. (The flip side: it lives in this
browser only, so clearing the browser's data or switching browsers means
starting fresh.)

## Using it offline

The board itself works without internet once the page has loaded. To make the
**engine analysis** work offline too, click **"Save for offline"** in the engine
panel — that keeps a copy of Stockfish (about 7 MB) on your device.

## Removing the offline app & Stockfish

To free up the space or remove it completely:

1. **If you installed it** to your home screen or desktop, uninstall it like any
   other app.
2. **Clear the saved data:** in your browser settings, find the site data /
   storage for this site and choose **Clear** (or **Delete data**). That removes
   the saved Stockfish engine, your game library, and the offline copy of the app.

   In Chrome it's quickest from the site itself: click the padlock icon in the
   address bar → **Site settings** → **Delete data**.
