# Change Request: Frontend Revamp v2 — shadcn/ui Component Library

## Doc Control

| Field | Value |
|-------|-------|
| Date | 2026-07-01 |
| Author | Orchestrator |
| Requested by | Muhammad Faraz |
| Status | Approved — Execute immediately |
| Affects | `frontend/` (all UI files) |

---

## 1. Summary

Replace the current custom Tailwind component library with **shadcn/ui** — the industry standard for production React apps. Keep all existing functionality, hooks, API contracts, auth logic, and routing completely unchanged. Pure UI layer swap with maximum polish.

---

## 2. Stack

| Layer | Current | New |
|-------|---------|-----|
| Components | Custom Tailwind | shadcn/ui (Radix UI primitives + Tailwind) |
| Icons | @heroicons/react | @heroicons/react (keep) + lucide-react (shadcn default) |
| Charts | chart.js + react-chartjs-2 | Keep (shadcn has no charts — use Recharts instead) |
| Animations | CSS transitions | tailwindcss-animate + shadcn motion |
| Theming | CSS vars (manual) | shadcn CSS vars (standardised + dark mode built-in) |
| Forms | Custom Input/Select | shadcn Form + react-hook-form + zod |

---

## 3. shadcn Components to Install

```
npx shadcn@latest init
npx shadcn@latest add button card badge input textarea select
npx shadcn@latest add dialog dropdown-menu sheet sidebar
npx shadcn@latest add table tabs progress avatar
npx shadcn@latest add alert alert-dialog toast sonner
npx shadcn@latest add skeleton separator scroll-area
npx shadcn@latest add tooltip popover command
npx shadcn@latest add chart (uses Recharts)
```

---

## 4. Design Direction — Max Level

- **Theme**: Deep navy sidebar (`#0f172a`), crisp white surfaces, electric blue (`#2563eb`) accent — Cloudelligent brand
- **Typography**: Inter variable font, tight letter-spacing on headings
- **Cards**: Subtle gradient border on hover, micro-shadow elevation system
- **Data tables**: Sticky header, row hover, sort indicators, inline badges
- **Phase progress**: Multi-step indicator with animated fill
- **Charts**: Recharts with smooth animations, custom tooltips, brand colors
- **Sidebar**: shadcn `<Sidebar>` with collapsible groups, icon + label layout
- **Modals**: shadcn `<Dialog>` with blur backdrop
- **Toasts**: shadcn `<Sonner>` — stacked, dismissible, with icons
- **Empty states**: Illustrated with lucide icon, gradient background card
- **Loading**: shadcn `<Skeleton>` with shimmer animation
- **Dark mode**: shadcn `.dark` class toggle, all components respect it natively

---

## 5. Effort

One full sprint. Max quality. No shortcuts.
