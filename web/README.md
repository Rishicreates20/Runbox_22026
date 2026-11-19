# Code+ web

The React frontend for the Code+ online judge. Submissions are judged by [`runbox`](../README.md), the sandbox in this repo.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
npm run build:static  # hash-routed build in dist-static/ for any static host or sub-path
```

Stack: Vite, React 19, TypeScript, React Router 7 and CodeMirror 6. Fonts are self-hosted through Fontsource: Space Grotesk for headings, Inter for body text and JetBrains Mono for code.

## Screens

| Route | What it does |
|---|---|
| `/login`, `/signup` | Email and password auth with validation, GitHub and Google buttons, and a password strength meter. The hero shows the plus-burst animation: the logo beats and code fragments fly outward from it. |
| `/problems` | Dashboard with solved-by-difficulty ring, a 20-week activity heatmap, streak, daily challenge and weekly-round countdowns. The problem table filters by difficulty, topic, status and search, sorts by acceptance, and keeps its filters in the URL. |
| `/problems/:id` | Workspace with the statement, a CodeMirror editor (C++17, C11, Python 3.12) and drafts autosaved per problem and language. Panels resize. Run checks the editable sample cases. Submit judges the hidden tests one by one and shows the runbox verdict, CPU time, memory and raw JSON. `Ctrl/⌘ + Enter` runs and `Ctrl/⌘ + Shift + Enter` submits. |
| `/submissions` | Every submission, filterable by verdict. |

## Demo mode and API mode

With no `VITE_API_URL` set, the app runs in **demo mode**. Accounts, sessions, drafts and submissions live in `localStorage`, and an in-browser judge simulates runbox:

- Submitting the untouched starter code gives Wrong Answer. Any other code gives Accepted.
- The **Demo judge** menu in the console forces any verdict (TLE, MLE, RE, SV, OLE, CE, IE) so every result state can be previewed.
- **Try the demo account** on the sign-in page logs in as `ada_l` with sample history.

The demo judge does not execute code. Custom test input needs a real server.

To use a real backend, copy `.env.example` to `.env` and set `VITE_API_URL`. The app then calls these endpoints, with cookies included:

| Method & path | Body | Response |
|---|---|---|
| `GET /auth/me` | | `{ user: User \| null }` |
| `POST /auth/login` | `{ email, password, remember }` | `{ user }`, or 4xx with `{ error }` |
| `POST /auth/signup` | `{ username, email, password }` | `{ user }` |
| `POST /auth/logout` | | `{}` |
| `GET /auth/github`, `GET /auth/google` | `?redirect=` | OAuth redirect |
| `POST /run` | `{ problemId, language, source, cases: string[] }` | `RunReport` |
| `POST /submissions` | `{ problemId, language, source }` | `{ id }` |
| `GET /submissions/:id` | | `{ status, tests: TestResult[], report?: JudgeReport }`, polled until `status === "done"` |

The shapes are defined in `src/lib/types.ts`. `JudgeReport.raw` is the JSON object runbox prints, passed through unchanged. Language ids are `cpp`, `c` and `py`.

## Layout

```
src/
  auth/         AuthContext (local and remote backends), demo account seed
  components/   Logo, PlusBurst, TopNav, badges, editor theme, icons
  data/         problem catalog, languages and starter code
  lib/          judge client (remote and demo), storage, stats, verdict metadata
  pages/        AuthPage, Problems, Workspace, Submissions, NotFound
  styles/       design tokens and shared primitives
```

The workspace route is lazy-loaded, so CodeMirror only downloads when a problem is opened. All motion respects `prefers-reduced-motion`.
