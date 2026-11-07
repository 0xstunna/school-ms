import { useState } from 'react';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import AlamaLogo from '../../components/common/AlamaLogo.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/common/Button.jsx';
import { Input } from '../../components/common/Input.jsx';

const Login = ({ schoolName }) => {
  const { login } = useAuth();
  const navigate   = useNavigate();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex font-body">
      {/* Left panel — decorative */}
      <div className="hidden lg:flex lg:w-[42%] bg-navy-950 flex-col justify-between p-12 relative overflow-hidden">
        {/* Background decorations */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-amber-500/10 -translate-y-1/3 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-56 h-56 rounded-full bg-navy-800/60 translate-y-1/4 -translate-x-1/4" />
        </div>

        <div className="relative">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center">
              <AlamaLogo className="w-6 h-6" />
            </div>
            <span className="font-display font-bold text-white text-lg">Alama</span>
          </div>

          <h1 className="font-display text-4xl font-bold text-white leading-tight mb-4">
            Run your<br />
            <span className="text-amber-400">school</span> with Alama
          </h1>
          <p className="text-navy-300 text-sm leading-relaxed max-w-xs">
            Complete offline-first management for students, staff, attendance, and academic records.
          </p>
        </div>

        <div className="relative">
          {[
            { n: '500+', l: 'Student Records' },
            { n: '30+',  l: 'Staff Members'   },
            { n: '100%', l: 'Offline Ready'   },
          ].map((s) => (
            <div key={s.l} className="flex items-center gap-3 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-white font-semibold text-sm">{s.n}</span>
              <span className="text-navy-400 text-sm">{s.l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-sm animate-slide-up">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-navy-900 flex items-center justify-center">
              <AlamaLogo className="w-7 h-7" />
            </div>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold text-slate-900 mb-1">Welcome back</h2>
            <p className="text-slate-500 text-sm">
              {schoolName ? `Sign in to ${schoolName}` : 'Sign in to your account'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Email Address"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={Mail}
              autoFocus
              required
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPw ? 'text' : 'password'}
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={Lock}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw((p) => !p)}
                className="absolute right-3 top-7 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 animate-fade-in">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full mt-2"
              size="lg"
              loading={loading}
            >
              Sign In
            </Button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-8">
            Forgot your password? Contact your administrator.
          </p>

          <div className="mt-8 pt-6 border-t border-slate-200">
            <p className="text-center text-xs text-slate-400">
              🔒 All data is stored securely on this device
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
