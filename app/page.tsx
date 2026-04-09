"use client";

import { useState } from "react";
import { DocPadLogoMark } from "./components/DocPadLogoMark";
import { createBrowserSupabaseClient } from "./lib/supabase/client";
import { supabase } from "./supabase";

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3L4 6v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V6l-8-3z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 11V7a4 4 0 118 0v4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.4 9.4 0 0112 5c6.5 0 10 7 10 7a18.5 18.5 0 01-5.1 5.3M6.2 6.2C3.8 8.1 2 12 2 12s3.5 7 10 7a9.7 9.7 0 004.7-1.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [loginMode, setLoginMode] = useState<"email" | "mobile">("email");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError(null);

    if (loginMode === "mobile") {
      setAuthError("Password sign-in uses your work email. Switch to Email login.");
      return;
    }

    const trimmed = email.trim();
    if (!trimmed || !password) {
      setAuthError("Enter your work email and password.");
      return;
    }

    setIsLoading(true);
    try {
      const testClient = createBrowserSupabaseClient();
      console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
    } catch (err) {
      setAuthError("Client init failed: " + String(err));
      setIsLoading(false);
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });

      if (error) {
        setIsLoading(false);
        const msg = error.message.toLowerCase();
        if (
          msg.includes("invalid login credentials") ||
          msg.includes("invalid email or password")
        ) {
          setAuthError("Wrong email or password. Please try again.");
        } else {
          setAuthError(error.message);
        }
        return;
      }
    } catch (err) {
      setIsLoading(false);
      setAuthError("Auth failed: " + String(err));
      return;
    }

    // Temporary: skip role fetch (RLS blocks practitioners on browser client on Vercel).
    window.location.assign("/opd");
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Left: branding */}
      <aside className="relative flex min-h-[280px] flex-1 flex-col overflow-hidden bg-[#1a56ff] px-8 py-10 text-white lg:min-h-screen lg:max-w-[50%] lg:px-12 lg:py-12">
        {/* Decorative circles */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
        >
          <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full border border-white/15" />
          <div className="absolute -right-16 top-10 h-96 w-96 rounded-full border border-white/10" />
          <div className="absolute bottom-0 left-1/3 h-[28rem] w-[28rem] rounded-full border border-white/10" />
          <div className="absolute bottom-32 right-[-20%] h-64 w-64 rounded-full border border-white/12" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1 shadow-sm">
              <DocPadLogoMark className="h-9 w-9" />
            </div>
            <span className="text-xl font-bold tracking-tight">DocPad</span>
          </div>

          <div className="mt-16 max-w-md lg:mt-24">
            <h1 className="text-3xl font-bold leading-tight tracking-tight lg:text-4xl">
              Secure clinical workspace
            </h1>
            <p className="mt-4 text-base font-normal text-white/90 lg:text-lg">
              For authorized hospital staff only
            </p>
          </div>

          <div className="mt-auto flex flex-wrap gap-8 pt-12 lg:pt-0">
            <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <ShieldIcon className="h-5 w-5 text-white" />
              </div>
              <span className="text-sm font-medium">HIPAA Secure</span>
            </div>
            <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <LockIcon className="h-5 w-5 text-white" />
              </div>
              <span className="text-sm font-medium">Encrypted</span>
            </div>
            <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
                <CheckIcon className="h-5 w-5 text-white" />
              </div>
              <span className="text-sm font-medium">Compliant</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Right: form */}
      <main className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-12 lg:px-12">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200/80 bg-white p-8 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <div className="flex rounded-2xl bg-neutral-100 p-1">
            <button
              type="button"
              onClick={() => setLoginMode("email")}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
                loginMode === "email"
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-700"
              }`}
            >
              Email login
            </button>
            <button
              type="button"
              onClick={() => setLoginMode("mobile")}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${
                loginMode === "mobile"
                  ? "bg-white text-neutral-900 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-700"
              }`}
            >
              Mobile login
            </button>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {authError ? (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {authError}
              </div>
            ) : null}

            {loginMode === "email" ? (
              <div>
                <label
                  htmlFor="work-email"
                  className="mb-2 block text-sm font-medium text-neutral-800"
                >
                  Work email
                </label>
                <input
                  id="work-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="doctor@hospital.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setAuthError(null);
                  }}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none ring-[#1a56ff]/30 transition focus:border-[#1a56ff] focus:ring-2"
                />
              </div>
            ) : (
              <div>
                <label
                  htmlFor="mobile"
                  className="mb-2 block text-sm font-medium text-neutral-800"
                >
                  Mobile number
                </label>
                <input
                  id="mobile"
                  name="mobile"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+1 (555) 000-0000"
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.target.value);
                    setAuthError(null);
                  }}
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none ring-[#1a56ff]/30 transition focus:border-[#1a56ff] focus:ring-2"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="password"
                className="mb-2 block text-sm font-medium text-neutral-800"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthError(null);
                  }}
                  className="w-full rounded-2xl border border-neutral-200 bg-white py-3 pl-4 pr-12 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none ring-[#1a56ff]/30 transition focus:border-[#1a56ff] focus:ring-2"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <a
                href="#"
                className="text-sm font-medium text-[#1a56ff] hover:underline"
              >
                Forgot password?
              </a>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 accent-[#1a56ff] focus:ring-2 focus:ring-[#1a56ff]/30"
              />
              <span className="text-sm text-neutral-700">
                Remember this device
              </span>
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-2xl bg-[#1a56ff] py-3.5 text-sm font-semibold text-white transition hover:bg-[#1547d9] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Signing in…" : "Log in"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs leading-relaxed text-neutral-500">
            By logging in, you agree to DocPad&apos;s terms and privacy policy
          </p>
        </div>

        <div className="mt-8 space-y-3 text-center text-sm text-neutral-600">
          <p>
            Need help?{" "}
            <a href="#" className="font-medium text-[#1a56ff] hover:underline">
              Contact IT support
            </a>
          </p>
          <p>
            New to DocPad?{" "}
            <a href="#" className="font-medium text-[#1a56ff] hover:underline">
              Sign up as a doctor
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
