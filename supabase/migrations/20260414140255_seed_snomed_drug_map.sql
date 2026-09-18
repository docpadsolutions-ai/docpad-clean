-- Restored from supabase_migrations.schema_migrations.
-- This is the SQL the database records as having actually run, on 20260414140255.

CREATE TABLE IF NOT EXISTS snomed_drug_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generic_pattern text NOT NULL,
  snomed_sctid text NOT NULL,
  snomed_term text NOT NULL,
  atc_code text,
  created_at timestamptz DEFAULT now()
);

INSERT INTO snomed_drug_map (generic_pattern, snomed_sctid, snomed_term, atc_code) VALUES
-- NSAIDs
('aceclofenac','391730008','Aceclofenac','M01AB16'),
('diclofenac','7034005','Diclofenac','M01AB05'),
('ibuprofen','38268001','Ibuprofen','M01AE01'),
('etoricoxib','416587008','Etoricoxib','M01AH05'),
('piroxicam','54552002','Piroxicam','M01AC01'),
('ketorolac','372501008','Ketorolac','M01AB15'),
('naproxen','372588000','Naproxen','M01AE02'),
('mefenamic','373506003','Mefenamic acid','M01AG01'),
('celecoxib','116081000','Celecoxib','M01AH01'),
('lornoxicam','108460001','Lornoxicam','M01AC05'),
-- Analgesics
('paracetamol','387517004','Paracetamol','N02BE01'),
('tramadol','386858008','Tramadol','N02AX02'),
('tapentadol','441757005','Tapentadol','N02AX06'),
-- Muscle relaxants
('tizanidine','373440006','Tizanidine','M03BX02'),
('thiocolchicoside','421747003','Thiocolchicoside','M03BX05'),
('chlorzoxazone','373466003','Chlorzoxazone','M03BB03'),
('baclofen','387342009','Baclofen','M03BX01'),
-- Antibiotics
('amoxicillin','27658006','Amoxicillin','J01CA04'),
('amoxycillin','27658006','Amoxicillin','J01CA04'),
('cefixime','96062004','Cefixime','J01DD08'),
('ceftriaxone','372670001','Ceftriaxone','J01DD04'),
('cefuroxime','372833007','Cefuroxime','J01DC02'),
('cefpodoxime','396049001','Cefpodoxime','J01DD13'),
('azithromycin','372574004','Azithromycin','J01FA10'),
('clarithromycin','387487009','Clarithromycin','J01FA09'),
('levofloxacin','387552007','Levofloxacin','J01MA12'),
('ofloxacin','387551000','Ofloxacin','J01MA01'),
('ciprofloxacin','372840008','Ciprofloxacin','J01MA02'),
('metronidazole','372602008','Metronidazole','J01XD01'),
('doxycycline','372478003','Doxycycline','J01AA02'),
('linezolid','387055003','Linezolid','J01XX08'),
('clindamycin','372786004','Clindamycin','J01FF01'),
('meropenem','387540000','Meropenem','J01DH02'),
('piperacillin','372837008','Piperacillin','J01CA12'),
('gentamicin','387321007','Gentamicin','J01GB03'),
('amikacin','387266003','Amikacin','J01GB06'),
('vancomycin','372735009','Vancomycin','J01XA01'),
-- PPIs/GI
('pantoprazole','395821003','Pantoprazole','A02BC02'),
('rabeprazole','395891002','Rabeprazole','A02BC04'),
('omeprazole','387137007','Omeprazole','A02BC01'),
('esomeprazole','396047004','Esomeprazole','A02BC05'),
('domperidone','387181004','Domperidone','A03FA03'),
('ondansetron','372487007','Ondansetron','A04AA01'),
-- Antihypertensives
('telmisartan','387069000','Telmisartan','C09CA07'),
('olmesartan','412259001','Olmesartan','C09CA08'),
('losartan','373567002','Losartan','C09CA01'),
('ramipril','386872004','Ramipril','C09AA05'),
('enalapril','372658000','Enalapril','C09AA02'),
('amlodipine','386864001','Amlodipine','C08CA01'),
('atenolol','387506000','Atenolol','C07AB03'),
('metoprolol','372826007','Metoprolol','C07AB02'),
('nebivolol','395892009','Nebivolol','C07AB12'),
-- Diuretics
('torsemide','108476002','Torsemide','C03CA04'),
('furosemide','387475002','Furosemide','C03CA01'),
('spironolactone','387078006','Spironolactone','C03DA01'),
('hydrochlorothiazide','387525002','Hydrochlorothiazide','C03AA03'),
-- Statins
('atorvastatin','373444002','Atorvastatin','C10AA05'),
('rosuvastatin','412299001','Rosuvastatin','C10AA07'),
('fenofibrate','386879001','Fenofibrate','C10AB05'),
-- Antidiabetics
('metformin','372567009','Metformin','A10BA02'),
('glimepiride','386966003','Glimepiride','A10BB12'),
('sitagliptin','423307000','Sitagliptin','A10BH01'),
('vildagliptin','431740004','Vildagliptin','A10BH02'),
('empagliflozin','703894002','Empagliflozin','A10BK03'),
('dapagliflozin','703672001','Dapagliflozin','A10BK01'),
-- Corticosteroids
('prednisolone','116601002','Prednisolone','H02AB06'),
('methylprednisolone','116602009','Methylprednisolone','H02AB04'),
('dexamethasone','372584003','Dexamethasone','H02AB02'),
('deflazacort','395941009','Deflazacort','H02AB13'),
-- Bone health
('alendronate','391737006','Alendronate','M05BA04'),
('cholecalciferol','18414002','Cholecalciferol','A11CC05'),
('calcitriol','11120004','Calcitriol','A11CC04'),
-- Anticoagulants
('warfarin','372756006','Warfarin','B01AA03'),
('aspirin','387458008','Aspirin','B01AC06'),
('clopidogrel','386952008','Clopidogrel','B01AC04'),
('enoxaparin','372562003','Enoxaparin','B01AB05'),
('rivaroxaban','442031002','Rivaroxaban','B01AF01'),
-- Neuro/Psych
('escitalopram','400447003','Escitalopram','N06AB10'),
('pregabalin','415160008','Pregabalin','N03AX16'),
('gabapentin','386845007','Gabapentin','N03AX12'),
('clonazepam','387383007','Clonazepam','N03AE01'),
-- Respiratory
('montelukast','395726003','Montelukast','R03DC03'),
('salbutamol','372897005','Salbutamol','R03AC02'),
('budesonide','395726003','Budesonide','R03BA02'),
-- Antihistamines
('cetirizine','372523007','Cetirizine','R06AE07'),
('levocetirizine','421889003','Levocetirizine','R06AE09'),
('fexofenadine','372523007','Fexofenadine','R06AX26'),
-- Antifungals
('fluconazole','387174006','Fluconazole','J02AC01'),
('itraconazole','387532006','Itraconazole','J02AC02'),
-- Thyroid
('levothyroxine','710809001','Levothyroxine','H03AA01')
ON CONFLICT DO NOTHING;
