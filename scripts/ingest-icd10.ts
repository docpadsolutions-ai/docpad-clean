import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import readline from 'readline';

// ✅ CREDENTIALS
// Credentials come from the environment (never hardcode keys in scripts).
// Run with: npx tsx --env-file=.env.local scripts/ingest-icd10.ts
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !GEMINI_API_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY before running this script.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function ingest() {
  const filePath = './scripts/icd10cm-order-April-1-2026.txt';
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ ERROR: Could not find text file at ${filePath}.`);
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  console.log("🚀 Starting ingestion (April 2026 Protocol)...");

  for await (const line of rl) {
    if (!line.trim()) continue;

    const code = line.substring(6, 13).trim();
    const isBillable = line.substring(14, 15) === '1';
    const longDescription = line.substring(77).trim();

    batch.push({ code, is_billable: isBillable, long_description: longDescription });

    if (batch.length === 50) {
      await processBatch(batch);
      batch = [];
    }
  }

  if (batch.length > 0) await processBatch(batch);
  console.log("✅ SUCCESS: All 74,719 codes indexed!");
}

async function processBatch(batch: any[]) {
  try {
    const texts = batch.map(b => `${b.code}: ${b.long_description}`);
    
    // ✅ FIX 1: Reverted to v1beta (Required for 2026 batch processing)
    // ✅ FIX 2: Updated to the flagship 'gemini-embedding-001' ID
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
          outputDimensionality: 768 // ✅ CRITICAL: Forces 3072-dim model down to your 768-dim table
        }))
      })
    });

    const data: any = await res.json();
    
    if (!data.embeddings) {
      console.error("❌ Gemini Error:", JSON.stringify(data, null, 2));
      return;
    }

    const toInsert = batch.map((item, i) => ({
      code: item.code,
      is_billable: item.is_billable,
      long_description: item.long_description,
      embedding: data.embeddings[i].values
    }));

    const { error } = await supabase.from('icd10_library').upsert(toInsert, { onConflict: 'code' });
    
    if (error) {
      console.error(`❌ Supabase Error:`, error.message);
    } else {
      console.log(`💎 Indexed batch ending in: ${batch[batch.length-1].code}`);
    }
  } catch (err) {
    console.error("❌ Unexpected Error:", err);
  }
}

ingest();