# DeliverPro Frontend

React + Vite + Tailwind CSS SPA for DeliverPro project governance platform.

## Setup

1. **Install dependencies:**
   ```bash
   npm ci
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env.local` and fill in your values:
   ```bash
   cp .env.example .env.local
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173)

## Available Scripts

- `npm run dev` — Start Vite development server
- `npm run build` — Build for production (TypeScript check + Vite build)
- `npm run preview` — Preview production build locally
- `npm run type-check` — Run TypeScript type checking
- `npm run lint` — Run ESLint

## Architecture

### Project Structure

```
src/
├── components/           # React components by feature
│   ├── gates/           # Gate/checkpoint components
│   └── layout/          # Layout components (AppShell, ProtectedRoute)
├── contexts/            # React contexts (Auth, etc.)
├── hooks/               # Custom hooks (useProjects, useGates, etc.)
├── lib/                 # Utilities (auth, API client)
├── pages/               # Page components (routes)
├── styles/              # Global CSS
└── types/               # TypeScript type definitions
```

### Key Features

- **Authentication** — Cognito user pool with JWT tokens (memory storage)
- **Protected Routes** — ProtectedRoute wrapper for auth-gated pages
- **API Integration** — Axios with JWT interceptors + automatic token refresh
- **State Management** — React Query for server state + local React state
- **Styling** — Tailwind CSS with custom design tokens

### Pages

- `/login` — Login form
- `/projects` — Project list with filters and search
- `/projects/:id` — Project detail with gates, checkpoints, artifacts
- `/dashboard` — Leadership/admin dashboard (coming soon)

### Components

- **ProtectedRoute** — Guards authenticated pages
- **AppShell** — Main layout with sidebar navigation
- **PhaseProgressBar** — Phase completion visualization
- **CheckpointModal** — Mark checkpoints complete
- **EvidenceModal** — Attach evidence to checkpoints

## Development

### Adding a new hook

1. Create `src/hooks/use{Feature}.ts`
2. Use `useApiClient()` for API calls
3. Use `@tanstack/react-query` for caching
4. Export from `src/hooks/` barrel

### Adding a new page

1. Create component in `src/pages/{PageName}.tsx`
2. Add route in `src/App.tsx`
3. Wrap with `<ProtectedRoute>` if auth-required
4. Use `useAuth()` to access current user

### Adding a new component

1. Create in `src/components/{Feature}/{ComponentName}.tsx`
2. Use Tailwind CSS for styling
3. Accept TypeScript props with explicit types
4. Export from component file

## Styling

All styling uses Tailwind CSS. No inline styles or CSS-in-JS.

### Color System

- `primary-*` — Brand blue (#3b82f6)
- `success-*` — Green for completed/positive states
- `warning-*` — Orange/amber for in-progress states
- `danger-*` — Red for errors/blocked states
- `neutral-*` — Grays for backgrounds and disabled states

### Spacing

- `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl` for consistent spacing
- Use Tailwind utilities (`p-4`, `mb-6`, etc.)

## Environment Variables

| Variable | Example | Required |
|----------|---------|----------|
| `VITE_API_BASE_URL` | `https://api.deliverpro.example.com` | Yes |
| `VITE_COGNITO_USER_POOL_ID` | `us-east-1_xxxxx` | Yes |
| `VITE_COGNITO_CLIENT_ID` | `xxxxx` | Yes |

## Browser Support

- Modern browsers (ES2020+)
- Chrome, Firefox, Safari, Edge (latest versions)

## Performance

- Code splitting via Vite
- Lazy loading for routes
- React Query caching
- Tailwind CSS purging in production

## Security

- JWT tokens stored in memory only (not localStorage)
- Refresh tokens in sessionStorage (cleared on tab close)
- CSRF protection via API gateway
- XSS prevention through React's default DOM escaping
- No secrets in frontend code

## Building for Production

```bash
npm run build
# Output: dist/

# Deploy dist/ to S3 + CloudFront
```

## Troubleshooting

### "Cannot find module '@/...'"

Make sure `tsconfig.json` has the baseUrl and paths configured:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Tokens not persisting after refresh

This is expected — tokens are stored in memory only. On page refresh, users are logged out and must log in again. This is the intended security design.

### CORS errors on API calls

Ensure your backend API Gateway has CORS configured with:
- Allowed origins: your CloudFront domain + localhost (dev)
- Allowed methods: GET, POST, PATCH, DELETE
- Allowed headers: Authorization, Content-Type
- Allow credentials: true

## License

Internal use only.
