"use client";

import { Suspense } from "react";
import { JoinFlow } from "../components/join/JoinFlow";

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <svg className="h-8 w-8 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-label="Loading">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    </div>
  );
}

/** Alias for invitation sign-up — same flow as `/join` and `/auth/signup`. */
export default function RegisterPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <JoinFlow />
    </Suspense>
  );
}
