import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, ShieldCheck, Info } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { completeNewPassword } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Stage = 'login' | 'new-password';

function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login, loading } = useAuth();

  const [stage, setStage] = useState<Stage>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/projects');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      if (msg === 'NEW_PASSWORD_REQUIRED') {
        setStage('new-password');
        setError('');
      } else {
        setError(msg);
      }
    }
  };

  const handleSetNewPassword = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await completeNewPassword(newPassword);
      navigate('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set new password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left brand panel */}
      <aside className="ds-gradient-anim relative hidden w-2/5 flex-col justify-between p-10 text-white md:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div className="leading-none">
            <p className="text-xl font-bold tracking-tight">DeliverPro</p>
            <p className="mt-1 text-xs text-white/70">AI-Powered Delivery Governance</p>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-3xl font-semibold leading-snug">
            Govern every project from discovery to delivery.
          </h2>
          <p className="max-w-sm text-sm text-white/70">
            Track phases, gates, and approvals across your entire portfolio in one place.
          </p>
        </div>

        <p className="text-xs text-white/50">© {new Date().getFullYear()} Cloudelligent</p>
      </aside>

      {/* Right form panel */}
      <main className="flex w-full items-center justify-center bg-muted/40 p-6 md:w-3/5">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2 md:hidden">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <span className="text-lg font-bold text-foreground">DeliverPro</span>
            </div>

            {/* Two-step progress indicator */}
            <div className="flex items-center gap-2" aria-hidden="true">
              <span
                className={
                  stage === 'login'
                    ? 'h-1.5 flex-1 rounded-full bg-primary'
                    : 'h-1.5 flex-1 rounded-full bg-emerald-500'
                }
              />
              <span
                className={
                  stage === 'new-password'
                    ? 'h-1.5 flex-1 rounded-full bg-primary'
                    : 'h-1.5 flex-1 rounded-full bg-border'
                }
              />
            </div>

            <div>
              <CardTitle className="text-xl">
                {stage === 'login' ? 'Welcome back' : 'Set your password'}
              </CardTitle>
              <CardDescription className="mt-1">
                {stage === 'login'
                  ? 'Sign in to your governance workspace.'
                  : 'Your administrator created your account — choose a permanent password.'}
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {stage === 'new-password' && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>One more step</AlertTitle>
                <AlertDescription>
                  This is your first sign-in. Set a permanent password to continue.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {stage === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                    placeholder="you@cloudelligent.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={loading}
                      className="pr-10"
                      placeholder="Enter your password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />}
                  Sign in
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSetNewPassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      disabled={submitting}
                      className="pr-10"
                      placeholder="Minimum 8 characters"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    disabled={submitting}
                    placeholder="Re-enter your new password"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="animate-spin" />}
                  Set password &amp; sign in
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={submitting}
                  onClick={() => {
                    setStage('login');
                    setError('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                >
                  ← Back to login
                </Button>
              </form>
            )}

            <p className="text-center text-sm text-muted-foreground">
              Access provided by your administrator
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export default LoginPage;
