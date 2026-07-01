# Change Request: Frontend Revamp — Modern UI + Dark/Light Mode

## Doc Control

| Field | Value |
|-------|-------|
| Date | 2026-07-01 |
| Author | Orchestrator |
| Requested by | Muhammad Faraz |
| Status | Approved |
| Affects | frontend/ (all files) |

---

## 1. Summary

Full frontend revamp. Keep all existing functionality and API contracts unchanged. Replace the basic Tailwind implementation with a polished, production-grade UI featuring dark/light mode, consistent design tokens, comprehensive error handling, and modern UX patterns.

---

## 2. What Changes

### Design System
- **Design tokens**: CSS custom properties for colors, spacing, radius, shadows — one source of truth for both themes
- **Dark / light mode**: system-preference detection via `prefers-color-scheme` + manual toggle persisted in localStorage
- **Typography**: Inter font (Google Fonts), consistent scale (xs → 4xl)
- **Color palette**: Cloudelligent brand blue primary, semantic success/warning/danger/info, neutral grays — all as CSS vars
- **Elevation / shadows**: 4-level shadow scale for cards, modals, dropdowns

### Component Library (built on top of Tailwind)
- `Button` — variants: primary, secondary, ghost, danger; sizes: sm, md, lg; loading spinner state
- `Card` — with header, body, footer slots; hover elevation
- `Badge` — status variants: success, warning, danger, info, neutral
- `Input`, `Textarea`, `Select` — unified form controls with error state, helper text, character count
- `Modal` — focus trap, ESC to close, backdrop blur, slide-in animation
- `Toast` — top-right notification stack (success/error/warning/info), auto-dismiss with progress bar
- `Spinner` / `Skeleton` — consistent loading states
- `EmptyState` — illustrated empty states per context
- `Tooltip` — on hover, keyboard accessible
- `Dropdown` — accessible, keyboard navigable

### Error Handling
- **Global error boundary** — catches React crashes, shows friendly recovery screen
- **API error interceptor** — Axios response interceptor maps HTTP codes to human-readable toasts
- **Form validation errors** — inline field-level error messages, not just toast
- **Network offline detection** — banner when browser goes offline
- **404 page** — friendly not-found with navigation
- **500 page** — with error code and "try again" action
- **Query error states** — every React Query `useQuery` has an error UI, not just loading

### Layout & Navigation
- **Sidebar** — collapsible, persists state in localStorage, shows active route
- **Breadcrumbs** — on all nested pages
- **Page header** — consistent title + subtitle + actions slot on every page
- **Responsive** — mobile-friendly (sidebar collapses to hamburger below md breakpoint)

### Page Upgrades
- **Login** — centered card, show/hide password, dark background with brand gradient
- **Projects list** — kanban-style phase columns OR table view (toggle), sortable columns, skeleton loading
- **Project detail** — sticky phase progress bar, collapsible phase sections, smooth transitions
- **Gate checkpoints** — visual status timeline instead of flat list, rich checkpoint cards
- **Leadership dashboard** — stat cards with trend indicators, phase distribution donut chart (Chart.js)

### Dark Mode Specifics
- Toggle in top-right of sidebar
- Theme stored in localStorage, defaults to system preference
- All components respect CSS vars — no hardcoded colors anywhere

---

## 3. What Does NOT Change

- All API calls, hooks, and data contracts — identical
- Route structure (`/login`, `/projects`, `/projects/:id`, `/dashboard`)
- Auth flow — Cognito PKCE unchanged
- All business logic in hooks (`useProjects`, `useGates`, etc.)

---

## 4. New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `chart.js` | `^4.4.0` | Dashboard charts |
| `react-chartjs-2` | `^5.2.0` | React wrapper for Chart.js |
| `react-hot-toast` | `^2.4.1` | Toast notifications |
| `@heroicons/react` | `^2.1.5` | Icon library |
| `clsx` | `^2.1.1` | Conditional classnames |

---

## 5. Effort Estimate

| Task | Points |
|------|--------|
| Design tokens + CSS vars + dark mode | 3 |
| Component library (Button, Card, Badge, Input, Modal, Toast) | 5 |
| Layout (sidebar, breadcrumbs, page header, responsive) | 4 |
| Error handling (boundary, interceptor, offline, 404/500) | 3 |
| Page revamps (login, projects, detail, dashboard) | 5 |
| **Total** | **20 pts (1 sprint)** |

*End of Change Request — 2026-07-01*
