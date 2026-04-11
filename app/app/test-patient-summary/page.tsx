'use client';

import { usePatientSummaryComplete } from '@/hooks/usePatientSummary';

export default function TestPatientSummaryPage() {
  // Use the test patient ID: DCP-624931
  const patientId = 'bcfe9692-87a6-4fef-99fc-3e02aa0233af';
  
  const { data, loading, error } = usePatientSummaryComplete(patientId);

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Testing Patient Summary</h1>
        <p>Loading patient data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Testing Patient Summary</h1>
        <div className="bg-red-50 border border-red-200 p-4 rounded">
          <p className="text-red-800 font-semibold">Error:</p>
          <p className="text-red-600">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Testing Patient Summary</h1>
      
      <div className="bg-green-50 border border-green-200 p-4 rounded mb-4">
        <p className="text-green-800 font-semibold">✅ Success! Data loaded</p>
      </div>

      <div className="bg-white border rounded p-4">
        <h2 className="font-semibold mb-2">Patient Data:</h2>
        <pre className="text-sm bg-gray-50 p-4 rounded overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    </div>
  );
}
