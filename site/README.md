# idle-compute landing / download site

A single static page (`index.html`) — the front door for the DePIN node. No build step.

## Deploy to Vercel
```bash
cd idle-compute/site
npx vercel        # or: drag this folder into vercel.com/new
```
Vercel auto-detects the static `index.html` and serves it. No config needed.

## Before you ship it
1. **Build the node exe**: from `idle-compute/`, run `npm run build:exe` → `dist/idle-compute-node.exe`.
2. **Upload the exe to GitHub Releases** (binaries belong there, not on Vercel — up to 2 GB/file, free).
3. **Update the two links** in `index.html` (currently placeholders):
   - the `Download the node` button → your release URL (e.g. `.../releases/latest`)
   - `View source` → your repo URL

That's the clean split: Vercel hosts this page, GitHub Releases hosts the ~82 MB binary, and the ~673 MB
model downloads itself on the operator's first run.
