import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart } from 'recharts';
import {
  FolderKanban,
  Rocket,
  Hammer,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Lock,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useReportingSummary } from '@/hooks/useReporting';
import { ReportingSummaryResponse } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

const PHASE_COLORS = ['#2563eb', '#0ea5e9', '#f59e0b', '#10b981', '#6366f1'];

const chartConfig: ChartConfig = {
  count: { label: 'Projects' },
};

function completionBarClass(pct: number): string {
  if (pct >= 80) return '[&>div]:bg-emerald-500';
  if (pct >= 50) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-red-500';
}

function completionTextClass(pct: number): string {
  if (pct >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  trend,
}: {
  label: string;
  value: number;
  icon: typeof FolderKanban;
  accent: string;
  trend?: 'up' | 'down';
}): JSX.Element {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="flex items-center gap-2">
            <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
            {trend &&
              (trend === 'up' ? (
                <TrendingUp className="h-4 w-4 text-red-500" aria-label="trending up" />
              ) : (
                <TrendingDown className="h-4 w-4 text-emerald-500" aria-label="trending down" />
              ))}
          </div>
        </div>
        <div
          className={cn('flex h-11 w-11 items-center justify-center rounded-lg', accent)}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardPage(): JSX.Element {
  const { user } = useAuth();
  const canView = !!user && ['leadership', 'admin'].includes(user.role);

  const { data, isLoading, isError, error, refetch } = useReportingSummary();
  // The hook returns the full Axios response; the payload is on `.data`.
  const summary = data?.data as ReportingSummaryResponse | undefined;

  const phaseTotals = useMemo(() => {
    const byPhase = summary?.projects_by_phase ?? [];
    const sumFor = (phases: string[]): number =>
      byPhase.filter((p) => phases.includes(p.phase)).reduce((acc, p) => acc + p.count, 0);
    return {
      phase01: sumFor(['Phase 0', 'Phase 1']),
      phase23: sumFor(['Phase 2', 'Phase 3']),
    };
  }, [summary]);

  const pieData = useMemo(
    () =>
      (summary?.projects_by_phase ?? []).map((p, i) => ({
        phase: p.phase_name,
        count: p.count,
        fill: PHASE_COLORS[i % PHASE_COLORS.length],
      })),
    [summary]
  );

  if (!canView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Leadership overview</p>
        </div>
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>Restricted</AlertTitle>
          <AlertDescription>
            This dashboard is restricted to leadership and admin users. Contact your administrator
            for access.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Leadership Dashboard</h1>
          <p className="text-sm text-muted-foreground">Cross-project governance overview</p>
        </div>
        {summary && (
          <span className="text-xs text-muted-foreground">
            Updated {new Date(summary.generated_at).toLocaleString()}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <Alert variant="destructive">
          <AlertTitle>Failed to load dashboard</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{error instanceof Error ? error.message : 'An unexpected error occurred.'}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && !isError && summary && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Active Projects"
              value={summary.total_active_projects}
              icon={FolderKanban}
              accent="bg-primary/10 text-primary"
            />
            <StatCard
              label="In Phase 0–1"
              value={phaseTotals.phase01}
              icon={Rocket}
              accent="bg-blue-500/10 text-blue-600 dark:text-blue-400"
            />
            <StatCard
              label="In Phase 2–3"
              value={phaseTotals.phase23}
              icon={Hammer}
              accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
            <StatCard
              label="Stalled"
              value={summary.stalled_projects.length}
              icon={AlertTriangle}
              accent="bg-red-500/10 text-red-600 dark:text-red-400"
              trend={summary.stalled_projects.length > 0 ? 'up' : 'down'}
            />
          </div>

          {/* Phase distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Phase Distribution</CardTitle>
              <CardDescription>Active projects grouped by delivery phase</CardDescription>
            </CardHeader>
            <CardContent>
              {pieData.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No phase data.</p>
              ) : (
                <ChartContainer
                  config={chartConfig}
                  className="mx-auto aspect-square max-h-[300px]"
                >
                  <PieChart>
                    <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                    <Pie data={pieData} dataKey="count" nameKey="phase" innerRadius={60} strokeWidth={4}>
                      {pieData.map((entry) => (
                        <Cell key={entry.phase} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              )}
              {pieData.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
                  {pieData.map((entry) => (
                    <div key={entry.phase} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.fill }}
                      />
                      <span className="text-muted-foreground">
                        {entry.phase} ({entry.count})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stalled projects */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Stalled Projects
                <Badge variant="neutral" className="ml-2">
                  {summary.stalled_projects.length}
                </Badge>
              </CardTitle>
              <CardDescription>Projects with no recent governance activity</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.stalled_projects.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No stalled projects — all projects have recent activity.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>PM</TableHead>
                      <TableHead>Phase</TableHead>
                      <TableHead>Last Activity</TableHead>
                      <TableHead className="text-center">Days</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.stalled_projects.map((p) => (
                      <TableRow key={p.jira_key}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{p.title}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {p.jira_key}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.project_manager || '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.current_phase}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.last_activity_at
                            ? new Date(p.last_activity_at).toLocaleDateString()
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="danger">{p.days_stalled}+</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button asChild variant="link" size="sm" className="gap-1">
                            <Link to={`/projects/${p.jira_key}`}>
                              View
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Gate completion */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gate Completion Rates</CardTitle>
              <CardDescription>Macro checkpoint completion across all projects</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.gate_completion_rates.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No gate completion data.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Checkpoint</TableHead>
                      <TableHead className="text-center">Completed</TableHead>
                      <TableHead className="w-1/3">Completion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...summary.gate_completion_rates]
                      .sort((a, b) => a.completion_pct - b.completion_pct)
                      .map((g) => (
                        <TableRow key={g.checkpoint_name}>
                          <TableCell className="font-medium text-foreground">
                            {g.checkpoint_name}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {g.completed_count}/{g.total_projects}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Progress
                                value={g.completion_pct}
                                className={cn('h-2 flex-1', completionBarClass(g.completion_pct))}
                              />
                              <span
                                className={cn(
                                  'w-12 shrink-0 text-right text-xs font-semibold',
                                  completionTextClass(g.completion_pct)
                                )}
                              >
                                {g.completion_pct.toFixed(1)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

export default DashboardPage;
