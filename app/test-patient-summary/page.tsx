'use client';

import { usePatientSummaryComplete } from '../hooks/usePatientSummary';

export default function Page() {
  const patientId = 'bcfe9692-87a6-4fef-99fc-3e02aa0233af';
  const { data, loading, error } = usePatientSummaryComplete(patientId);

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold mb-4">Error</h1>
        <p className="text-red-600">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-xl font-bold mb-4">✅ Success!</h1>
      <pre className="bg-gray-100 p-4 rounded text-sm">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
