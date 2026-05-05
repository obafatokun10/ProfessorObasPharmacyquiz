# CRA Law — Pharmacy Law & Governance Practice

Mobile-friendly web app for practising GPhC Common Registration Assessment questions on UK pharmacy law and governance. 180 verified questions covering CDs, emergency supply, MEP/HMR/MDR, GPhC Standards, FtP, MHRA alerts, PGDs, NHS contract, and more.

## Deploy to GitHub Pages (free, ~5 minutes)

You only need a GitHub account. Sign up at https://github.com/join if you don't have one.

### Steps

1. **Create a new GitHub repository:**
   - Go to https://github.com/new
   - Repository name: `cra-law-app` (you can change this — see "Different repo name" below)
   - Set to **Public** (Pages is free for public repos)
   - Don't initialise with a README or .gitignore
   - Click "Create repository"

2. **Upload the project files:**
   - On the new empty repository page, click "uploading an existing file"
   - Drag the entire contents of this folder (the files inside, NOT the parent folder) — including `src/`, `public/`, `.github/`, `package.json`, `vite.config.js`, `index.html`, `.gitignore`
   - **Important:** the `.github/` folder is hidden by default on Mac/Linux. On Mac, press Cmd+Shift+. in Finder to show hidden files. On Windows, set Folder Options → "Show hidden files".
   - Scroll down, click "Commit changes"

3. **Enable GitHub Pages:**
   - In your repository, go to Settings → Pages (left sidebar)
   - Under "Build and deployment", set **Source** to **GitHub Actions**
   - That's it — no other settings to change

4. **Trigger the first deploy:**
   - Go to the Actions tab in your repo
   - You should see a "Deploy to GitHub Pages" workflow running automatically (started by your file upload)
   - If not, click "Deploy to GitHub Pages" → "Run workflow" → "Run workflow"
   - Wait ~2 minutes for the green tick

5. **Get your URL:**
   - Settings → Pages will show "Your site is live at https://<username>.github.io/cra-law-app/"
   - Share that with anyone

### Different repo name

If you call your repo something other than `cra-law-app` (e.g. `pharmacy-law-practice`), the workflow handles it automatically — `VITE_BASE_PATH` is set from the repo name at build time. No config changes needed.

### Custom domain (optional)

In Settings → Pages, you can attach a custom domain you own. Add a CNAME record from your domain provider pointing to `<username>.github.io`, then enter the domain in GitHub Pages settings. GitHub provides a free SSL certificate.

## Updating the app

Whenever you push changes to the `main` branch, GitHub Actions rebuilds and redeploys automatically. To edit:

- Question bank: edit `src/questions.json`
- App logic: edit `src/App.jsx`
- Styling: edit `src/index.css` and the styles object at the bottom of `src/App.jsx`

For small edits you can use GitHub's web editor (the pencil icon on any file). For bigger edits, clone the repo locally.

## Running locally (optional)

If you want to test changes before pushing:

```bash
npm install
npm run dev
```

Opens at http://localhost:5173. Local dev uses `/` as the base path so paths work correctly.

## Tech stack

- React 18 + Vite (build tool)
- localStorage for persistence (per-profile namespacing: `gphc:<userKey>:<keyType>`)
- No backend, no analytics, no tracking
- Build artifacts deployed to GitHub Pages via GitHub Actions

## Data and privacy

All progress is stored in the user's browser via localStorage. Nothing is sent to a server. Users can have multiple profiles on one device; clearing browser data clears progress.

## Troubleshooting

**"My site shows a blank page"** — Check that GitHub Pages source is set to "GitHub Actions" (not "Deploy from a branch"). Also check the Actions tab to confirm the workflow ran successfully.

**"Assets fail to load with 404"** — This usually means the `base` path in `vite.config.js` doesn't match your repo name. The workflow sets it automatically from the repo name, so this only happens if you run `npm run build` locally without setting `VITE_BASE_PATH`. For local testing of the production build, run: `VITE_BASE_PATH=/your-repo-name/ npm run build && npm run preview`.

**"The Actions tab says permission denied"** — Go to Settings → Actions → General → "Workflow permissions" and set it to "Read and write permissions".
