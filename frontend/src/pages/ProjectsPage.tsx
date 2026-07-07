import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Search,
  X,
  Table as TableIcon,
  LayoutGrid,
  FolderOpen,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
  Plus,
  Download,
  RefreshCw,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { ProjectSummary } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useProjects, useCreateProject, useImportJira } from '@/hooks/useProjects';
import { LinkageFields } from '@/components/projects/LinkageFields';
import {
  buildLinkagePayload,
  canManageLinkage,
  EMPTY_LINKAGE_VALUES,
  hasErrors,
  mapServerError,
  validateLinkageValues,
  type LinkageErrors,
  type LinkageField,
  type LinkageValues,
} from '@/lib/linkage';

type ViewMode = 'table' | 'card';
type SortKey =
  | 'title'
  | 'current_phase'
  | 'project_type'
  | 'project_manager'
  | 'solution_architect'
  | 'burn_rate_pct'
  | 'status';
type SortDir = 'asc' | 'desc';

const VIEW_STORAGE_KEY = 'projects-view-mode';
const ALL = 'all';

const PHASE_VARIANT: Record<string, BadgeVariant> = {
  'Phase 0': 'neutral',
  'Phase 1': 'info',
  'Phase 2': 'warning',
  'Phase 3': 'warning',
  'Phase 4': 'success',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  Active: 'success',
  Closing: 'warning',
  Closed: 'neutral',
  'On Hold': 'info',
};

function phaseVariant(phase: string): BadgeVariant {
  return PHASE_VARIANT[phase] ?? 'neutral';
}

function statusVariant(status: string | null): BadgeVariant {
  if (!status) return 'neutral';
  return STATUS_VARIANT[status] ?? 'neutral';
}

function burnRateBarClass(pct: number | null): string {
  if (pct == null) return '[&>div]:bg-muted-foreground';
  if (pct < 70) return '[&>div]:bg-emerald-500';
  if (pct < 90) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-red-500';
}

function burnRateTextClass(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground';
  if (pct < 70) return 'text-emerald-600 dark:text-emerald-400';
  if (pct < 90) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function TeamAvatar({ name, label }: { name: string | null; label: string }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Avatar className="h-7 w-7 border">
          <AvatarFallback className="bg-muted text-[11px] font-semibold text-muted-foreground">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>
        {label}: {name ?? '—'}
      </TooltipContent>
    </Tooltip>
  );
}

function BurnRate({ pct }: { pct: number | null }): JSX.Element {
  const width = pct == null ? 0 : Math.min(pct, 100);
  return (
    <div className="flex items-center gap-2">
      <Progress value={width} className={cn('h-1.5 w-24', burnRateBarClass(pct))} />
      <span className={cn('w-10 shrink-0 text-right text-xs font-medium', burnRateTextClass(pct))}>
        {pct == null ? 'N/A' : `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  allLabel: string;
}): JSX.Element {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
      <SelectTrigger className="w-[150px]" aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}): JSX.Element {
  const active = sortKey === column;
  return (
    <TableHead className={className}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onSort(column)}
        className="-ml-2 h-8 gap-1 px-2 text-muted-foreground hover:text-foreground data-[active=true]:text-foreground"
        data-active={active}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </Button>
    </TableHead>
  );
}

function ProjectsPage(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canManageLink = canManageLinkage(user?.role);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [pmFilter, setPmFilter] = useState('');
  const [saFilter, setSaFilter] = useState('');

  const [showNewProject, setShowNewProject] = useState(false);
  const [showImportJira, setShowImportJira] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState({
    title: '',
    project_type: 'AppDev',
    description: '',
    project_manager: '',
    solution_architect: '',
    sow_hours: '',
  });
  const [jiraForm, setJiraForm] = useState({
    jira_base_url: 'https://cloudelligent.atlassian.net',
    project_key: 'CST',
  });
  const [linkage, setLinkage] = useState<LinkageValues>(EMPTY_LINKAGE_VALUES);
  const [linkageErrors, setLinkageErrors] = useState<LinkageErrors>({});
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const createProject = useCreateProject();
  const importJira = useImportJira();

  const handleLinkageChange = (field: LinkageField, value: string): void => {
    setLinkage((v) => ({ ...v, [field]: value }));
    setLinkageErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const resetNewProject = (): void => {
    setNewProjectForm({
      title: '',
      project_type: 'AppDev',
      description: '',
      project_manager: '',
      solution_architect: '',
      sow_hours: '',
    });
    setLinkage(EMPTY_LINKAGE_VALUES);
    setLinkageErrors({});
    setCreateFormError(null);
  };

  const handleCreateProject = async (): Promise<void> => {
    setCreateFormError(null);

    let linkagePayload: Partial<Record<LinkageField, string | null>> = {};
    if (canManageLink) {
      const clientErrors = validateLinkageValues(linkage);
      if (hasErrors(clientErrors)) {
        setLinkageErrors(clientErrors);
        return;
      }
      linkagePayload = buildLinkagePayload(linkage, 'create');
    }

    try {
      await createProject.mutateAsync({
        title: newProjectForm.title,
        project_type: newProjectForm.project_type,
        ...(newProjectForm.project_manager && {
          project_manager: newProjectForm.project_manager,
        }),
        ...(newProjectForm.solution_architect && {
          solution_architect: newProjectForm.solution_architect,
        }),
        ...(newProjectForm.sow_hours && { sow_hours: Number(newProjectForm.sow_hours) }),
        ...linkagePayload,
      });
      toast.success('Project created successfully');
      setShowNewProject(false);
      resetNewProject();
    } catch (err) {
      const mapped = mapServerError(err);
      setLinkageErrors(mapped.fieldErrors);
      setCreateFormError(mapped.formError);
      if (!hasErrors(mapped.fieldErrors) && !mapped.formError) {
        toast.error('Failed to create project');
      }
    }
  };

  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode | null) ?? 'table'
  );
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const setViewMode = (mode: string): void => {
    const next = mode as ViewMode;
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useProjects({
    search: debouncedSearch,
    status,
    phase,
    limit: 50,
  });

  const projects = useMemo<ProjectSummary[]>(() => data?.projects ?? [], [data]);

  const typeOptions = useMemo(
    () => [...new Set(projects.map((p) => p.project_type).filter((v): v is string => !!v))].sort(),
    [projects]
  );
  const pmOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.project_manager).filter((v): v is string => !!v))].sort(),
    [projects]
  );
  const saOptions = useMemo(
    () =>
      [...new Set(projects.map((p) => p.solution_architect).filter((v): v is string => !!v))].sort(),
    [projects]
  );

  const filtered = useMemo(() => {
    const result = projects.filter(
      (p) =>
        (!typeFilter || p.project_type === typeFilter) &&
        (!pmFilter || p.project_manager === pmFilter) &&
        (!saFilter || p.solution_architect === saFilter)
    );

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [projects, typeFilter, pmFilter, saFilter, sortKey, sortDir]);

  const activeCount = projects.filter((p) => p.status === 'Active').length;
  const totalCount = data?.total_count ?? projects.length;
  const hasActiveFilters = Boolean(
    status || phase || typeFilter || pmFilter || saFilter || debouncedSearch
  );

  const handleSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const clearFilters = (): void => {
    setSearch('');
    setStatus('');
    setPhase('');
    setTypeFilter('');
    setPmFilter('');
    setSaFilter('');
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Projects</h1>
            <Badge variant="secondary">{totalCount}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{activeCount} active in this view</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && (
            <Button variant="outline" className="gap-2" onClick={() => setShowImportJira(true)}>
              <Download />
              Import from Jira
            </Button>
          )}
          <Button className="gap-2" onClick={() => setShowNewProject(true)}>
            <Plus />
            New Project
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or Jira key…"
            aria-label="Search projects"
            className="pl-9 pr-9"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
            >
              <X />
            </Button>
          )}
        </div>

        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="Status"
          allLabel="All statuses"
          options={[
            { value: 'Active', label: 'Active' },
            { value: 'Closing', label: 'Closing' },
            { value: 'Closed', label: 'Closed' },
            { value: 'On Hold', label: 'On Hold' },
          ]}
        />
        <FilterSelect
          value={phase}
          onChange={setPhase}
          placeholder="Phase"
          allLabel="All phases"
          options={[
            { value: 'Phase 0', label: 'Phase 0' },
            { value: 'Phase 1', label: 'Phase 1' },
            { value: 'Phase 2', label: 'Phase 2' },
            { value: 'Phase 3', label: 'Phase 3' },
            { value: 'Phase 4', label: 'Phase 4' },
          ]}
        />
        <FilterSelect
          value={typeFilter}
          onChange={setTypeFilter}
          placeholder="Type"
          allLabel="All types"
          options={typeOptions.map((t) => ({ value: t, label: t }))}
        />
        <FilterSelect
          value={pmFilter}
          onChange={setPmFilter}
          placeholder="PM"
          allLabel="All PMs"
          options={pmOptions.map((p) => ({ value: p, label: p }))}
        />
        <FilterSelect
          value={saFilter}
          onChange={setSaFilter}
          placeholder="SA"
          allLabel="All SAs"
          options={saOptions.map((s) => ({ value: s, label: s }))}
        />

        {hasActiveFilters && (
          <Button variant="ghost" className="gap-1.5" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}

        <Tabs value={view} onValueChange={setViewMode} className="ml-auto">
          <TabsList>
            <TabsTrigger value="table" className="gap-1.5">
              <TableIcon className="h-4 w-4" />
              Table
            </TabsTrigger>
            <TabsTrigger value="card" className="gap-1.5">
              <LayoutGrid className="h-4 w-4" />
              Cards
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Error */}
      {isError && !isLoading && (
        <Alert variant="destructive">
          <AlertTitle>Failed to load projects</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error instanceof Error ? error.message : 'An unexpected error occurred.'}</span>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading &&
        (view === 'table' ? (
          <Card>
            <CardContent className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="space-y-4 p-5">
                  <Skeleton className="h-5 w-3/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-2 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ))}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FolderOpen className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">
                {hasActiveFilters ? 'No matching projects' : 'No projects yet'}
              </h3>
              <p className="max-w-sm text-sm text-muted-foreground">
                {hasActiveFilters
                  ? 'Try adjusting your search or filters to find what you’re looking for.'
                  : 'Get started by creating your first delivery project.'}
              </p>
            </div>
            {hasActiveFilters ? (
              <Button variant="outline" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button onClick={() => setShowNewProject(true)} className="gap-2">
                <Plus />
                Create your first project
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {!isLoading && !isError && filtered.length > 0 && (
        <Tabs value={view} onValueChange={setViewMode}>
          {/* Table view */}
          <TabsContent value="table" className="mt-0">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHeader label="Project" column="title" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Phase" column="current_phase" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Type" column="project_type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="PM" column="project_manager" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="SA" column="solution_architect" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <SortHeader label="Burn Rate" column="burn_rate_pct" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-44" />
                    <SortHeader label="Status" column="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow
                      key={p.id}
                      onClick={() => navigate(`/projects/${p.jira_key}`)}
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{p.title}</span>
                          <span className="font-mono text-xs text-muted-foreground">{p.jira_key}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={phaseVariant(p.current_phase)}>{p.current_phase}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.project_type || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{p.project_manager || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{p.solution_architect || '—'}</TableCell>
                      <TableCell>
                        <BurnRate pct={p.burn_rate_pct} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(p.status)}>{p.status || 'N/A'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Card view */}
          <TabsContent value="card" className="mt-0">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <Card
                  key={p.id}
                  onClick={() => navigate(`/projects/${p.jira_key}`)}
                  className="group cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-foreground group-hover:text-primary">
                          {p.title}
                        </h3>
                        <span className="font-mono text-xs text-muted-foreground">{p.jira_key}</span>
                      </div>
                      <Badge variant={phaseVariant(p.current_phase)}>{p.current_phase}</Badge>
                    </div>

                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {p.description || 'No description.'}
                    </p>

                    <div>
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Burn rate</p>
                      <BurnRate pct={p.burn_rate_pct} />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TeamAvatar name={p.project_manager} label="PM" />
                        <TeamAvatar name={p.solution_architect} label="SA" />
                      </div>
                      <Badge variant={statusVariant(p.status)}>{p.status || 'N/A'}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* New Project dialog */}
      <Dialog
        open={showNewProject}
        onOpenChange={(open) => {
          setShowNewProject(open);
          if (!open) resetNewProject();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Add a new delivery project. CASDM gate template will be seeded automatically.
            </DialogDescription>
          </DialogHeader>
          {createFormError && (
            <Alert variant="destructive">
              <AlertDescription>{createFormError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="title">Project Title *</Label>
              <Input
                id="title"
                placeholder="e.g. RAINN Referral Platform"
                value={newProjectForm.title}
                onChange={(e) => setNewProjectForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project_type">Project Type</Label>
              <Select
                value={newProjectForm.project_type}
                onValueChange={(v) => setNewProjectForm((f) => ({ ...f, project_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AppDev">App Development</SelectItem>
                  <SelectItem value="AppMod">App Modernization</SelectItem>
                  <SelectItem value="AIML">AI / ML</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pm">Project Manager (email)</Label>
              <Input
                id="pm"
                placeholder="pm@cloudelligent.com"
                value={newProjectForm.project_manager}
                onChange={(e) =>
                  setNewProjectForm((f) => ({ ...f, project_manager: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sa">Solution Architect (email)</Label>
              <Input
                id="sa"
                placeholder="sa@cloudelligent.com"
                value={newProjectForm.solution_architect}
                onChange={(e) =>
                  setNewProjectForm((f) => ({ ...f, solution_architect: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sow">SOW Hours</Label>
              <Input
                id="sow"
                type="number"
                placeholder="160"
                value={newProjectForm.sow_hours}
                onChange={(e) => setNewProjectForm((f) => ({ ...f, sow_hours: e.target.value }))}
              />
            </div>
            {canManageLink && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-semibold text-foreground">GitHub &amp; Slack linkage</p>
                <LinkageFields
                  mode="create"
                  values={linkage}
                  errors={linkageErrors}
                  onChange={handleLinkageChange}
                  disabled={createProject.isPending}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewProject(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newProjectForm.title || createProject.isPending}
              onClick={() => void handleCreateProject()}
            >
              {createProject.isPending ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from Jira dialog */}
      <Dialog open={showImportJira} onOpenChange={setShowImportJira}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import from Jira</DialogTitle>
            <DialogDescription>
              One-time import of projects from your Jira CST board. Requires Jira API token in
              Secrets Manager.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="jira_url">Jira Base URL</Label>
              <Input
                id="jira_url"
                value={jiraForm.jira_base_url}
                onChange={(e) => setJiraForm((f) => ({ ...f, jira_base_url: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project_key">Project Key</Label>
              <Input
                id="project_key"
                placeholder="CST"
                value={jiraForm.project_key}
                onChange={(e) => setJiraForm((f) => ({ ...f, project_key: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                The Jira project key to import (e.g. CST for Customer Status Tracking)
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportJira(false)}>
              Cancel
            </Button>
            <Button
              disabled={!jiraForm.project_key || importJira.isPending}
              onClick={async () => {
                try {
                  const result = await importJira.mutateAsync(jiraForm);
                  toast.success(`Imported ${result.imported} projects (${result.errors} errors)`);
                  setShowImportJira(false);
                } catch (err: unknown) {
                  const msg =
                    err && typeof err === 'object' && 'response' in err
                      ? (err as { response: { data: { message: string } } }).response?.data?.message
                      : 'Import failed';
                  toast.error(msg || 'Import failed');
                }
              }}
            >
              {importJira.isPending ? 'Importing...' : 'Start Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProjectsPage;
