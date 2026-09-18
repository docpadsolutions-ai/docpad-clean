-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414135820.

-- Enrich drugs with drug_class based on generic_name patterns
-- This covers the major classes in an ortho+general practice pharmacy

UPDATE drugs SET drug_class = CASE
  -- NSAIDs
  WHEN lower(generic_name) ~ '(aceclofenac|diclofenac|ibuprofen|naproxen|piroxicam|etoricoxib|celecoxib|mefenamic|ketorolac|lornoxicam|indomethacin)' THEN 'NSAID'
  -- Analgesics
  WHEN lower(generic_name) ~ '(paracetamol|tramadol|tapentadol)' AND lower(generic_name) NOT LIKE '%+%' THEN 'Analgesic'
  WHEN lower(generic_name) ~ '(paracetamol|tramadol)' AND lower(generic_name) LIKE '%+%' AND lower(generic_name) ~ '(aceclofenac|diclofenac|ibuprofen)' THEN 'NSAID + Analgesic'
  -- Muscle relaxants
  WHEN lower(generic_name) ~ '(tizanidine|thiocolchicoside|chlorzoxazone|metaxalone|baclofen|dantrolene|cyclobenzaprine)' THEN 'Muscle Relaxant'
  -- Antibiotics
  WHEN lower(generic_name) ~ '(amoxicillin|amoxycillin|cefixime|ceftriaxone|cefuroxime|cefpodoxime|azithromycin|clarithromycin|levofloxacin|ofloxacin|ciprofloxacin|metronidazole|doxycycline|linezolid|clindamycin|meropenem|piperacillin|cephalexin|nitrofurantoin|norfloxacin|cotrimoxazole|gentamicin)' THEN 'Antibiotic'
  -- Antifungals
  WHEN lower(generic_name) ~ '(fluconazole|itraconazole|clotrimazole|terbinafine|ketoconazole|voriconazole)' THEN 'Antifungal'
  -- PPIs / GI
  WHEN lower(generic_name) ~ '(pantoprazole|rabeprazole|omeprazole|esomeprazole|lansoprazole|domperidone|ondansetron|sucralfate|ranitidine|famotidine)' THEN 'GI / PPI'
  -- Antihypertensives
  WHEN lower(generic_name) ~ '(telmisartan|olmesartan|losartan|ramipril|enalapril|amlodipine|nifedipine|atenolol|metoprolol|nebivolol|bisoprolol|carvedilol|prazosin|clonidine|hydralazine)' THEN 'Antihypertensive'
  -- Diuretics
  WHEN lower(generic_name) ~ '(torsemide|furosemide|hydrochlorothiazide|spironolactone|chlorthalidone|indapamide|metolazone)' THEN 'Diuretic'
  -- Statins / Lipid
  WHEN lower(generic_name) ~ '(atorvastatin|rosuvastatin|fenofibrate|ezetimibe)' THEN 'Lipid Lowering'
  -- Antidiabetics
  WHEN lower(generic_name) ~ '(metformin|glimepiride|sitagliptin|vildagliptin|gliclazide|pioglitazone|empagliflozin|dapagliflozin|insulin|teneligliptin)' THEN 'Antidiabetic'
  -- Anticoagulants / Antiplatelets
  WHEN lower(generic_name) ~ '(warfarin|rivaroxaban|apixaban|dabigatran|aspirin|clopidogrel|prasugrel|ticagrelor|enoxaparin|heparin)' THEN 'Anticoagulant/Antiplatelet'
  -- Corticosteroids
  WHEN lower(generic_name) ~ '(prednisolone|methylprednisolone|dexamethasone|hydrocortisone|deflazacort|betamethasone|triamcinolone)' THEN 'Corticosteroid'
  -- Calcium / Bone
  WHEN lower(generic_name) ~ '(calcium|cholecalciferol|alfacalcidol|alendronate|zoledronic|calcitriol|vitamin d)' THEN 'Calcium / Bone Health'
  -- Vitamins / Supplements
  WHEN lower(generic_name) ~ '(vitamin|b-complex|folic acid|iron|methylcobalamin|thiamine|pyridoxine|biotin|zinc)' THEN 'Vitamin / Supplement'
  -- Benzodiazepines / Sedatives
  WHEN lower(generic_name) ~ '(clonazepam|diazepam|lorazepam|alprazolam|midazolam|zolpidem|zopiclone)' THEN 'Benzodiazepine / Sedative'
  -- Antidepressants
  WHEN lower(generic_name) ~ '(escitalopram|sertraline|fluoxetine|paroxetine|duloxetine|venlafaxine|amitriptyline|mirtazapine|fluvoxamine)' THEN 'Antidepressant'
  -- Antiepileptics / Neuropathic
  WHEN lower(generic_name) ~ '(pregabalin|gabapentin|carbamazepine|valproate|levetiracetam|phenytoin|topiramate|oxcarbazepine)' THEN 'Antiepileptic / Neuropathic'
  -- Antihistamines
  WHEN lower(generic_name) ~ '(cetirizine|levocetirizine|fexofenadine|montelukast|chlorpheniramine|hydroxyzine|desloratadine|bilastine)' THEN 'Antihistamine / Anti-allergy'
  -- Bronchodilators
  WHEN lower(generic_name) ~ '(salbutamol|theophylline|etophylline|ipratropium|budesonide|formoterol|acebrophylline|dextromethorphan|ambroxol|bromhexine|acetylcysteine)' THEN 'Respiratory'
  -- Thyroid
  WHEN lower(generic_name) ~ '(thyroxine|levothyroxine|carbimazole)' THEN 'Thyroid'
  -- Topical / Derma
  WHEN lower(generic_name) ~ '(mupirocin|fusidic|silver sulfadiazine|povidone|calamine)' THEN 'Topical / Dermatological'
  -- IV fluids / devices
  WHEN lower(generic_name) ~ '(dextrose|saline|ringer|device|consumable|surgical)' THEN 'IV Fluid / Device'
  ELSE NULL
END
WHERE drug_class IS NULL;
