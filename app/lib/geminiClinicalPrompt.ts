/**
 * Specialty-aware system prompt for Gemini Flash — structured findings with body site split from clinical term.
 */
export function buildGeminiSystemPrompt(specialty: string, contextType: string): string {
  const SPECIALTY_CONTEXTS: Record<string, string> = {
    Orthopaedics: `
SPECIALTY: Orthopaedic Surgery
COMMON ANATOMY: knee, hip, shoulder, elbow, wrist, ankle, spine (cervical/thoracic/lumbar/sacral), 
  femur, tibia, fibula, humerus, radius, ulna, patella, scapula, clavicle, pelvis, calcaneus, 
  metatarsal, phalanx, intervertebral disc, meniscus, ACL, PCL, rotator cuff, labrum
COMMON FINDINGS: fracture, dislocation, subluxation, deformity, swelling, effusion, 
  crepitus, instability, restricted ROM, tenderness, muscle wasting, limping/antalgic gait,
  non-union, malunion, avascular necrosis, osteoarthritis, trigger finger, carpal tunnel,
  nerve palsy, compartment syndrome, wound discharge, pin site infection
COMMON EXAMINATION TERMS: varus/valgus, drawer test, McMurray test, Lachman test, 
  impingement sign, Tinel sign, Phalen test, straight leg raise, FABER test, 
  Thompson test, range of motion (flexion/extension/abduction/adduction/rotation)`,

    "General Medicine": `
SPECIALTY: General Medicine / Internal Medicine
COMMON ANATOMY: chest, lungs, heart, abdomen, liver, kidney, throat, oral cavity, 
  lymph nodes (cervical/axillary/inguinal), thyroid, joints (any), skin, CNS
COMMON FINDINGS: fever, cough, breathlessness, wheeze, crepitations, rhonchi, 
  hepatomegaly, splenomegaly, pallor, icterus, cyanosis, clubbing, oedema, 
  tachycardia, bradycardia, murmur, JVP raised, ascites
COMMON EXAMINATION TERMS: auscultation findings (S1/S2/murmur grade), 
  breath sounds (vesicular/bronchial), bowel sounds, shifting dullness, 
  fluid thrill, Kernig sign, Brudzinski sign`,

    "Obstetrics and Gynaecology": `
SPECIALTY: Obstetrics and Gynaecology
COMMON ANATOMY: uterus, cervix, ovary, fallopian tube, vagina, vulva, perineum,
  breast, pelvis, fundus, lower segment, pouch of Douglas
COMMON FINDINGS: amenorrhea, menorrhagia, dysmenorrhea, discharge (per vaginum),
  bleeding PV, pain lower abdomen, fetal movements, contractions, 
  cervical dilation, effacement, presentation (cephalic/breech/transverse)
COMMON EXAMINATION TERMS: per vaginal examination, per speculum, 
  fundal height, fetal heart rate, Bishop score, lie, presentation, position`,

    Paediatrics: `
SPECIALTY: Paediatrics
COMMON ANATOMY: all general anatomy + fontanelle, umbilicus, tonsils
COMMON FINDINGS: failure to thrive, poor feeding, irritability, lethargy, 
  rash, diarrhoea, vomiting, febrile seizure, stridor, grunting, 
  nasal flaring, chest indrawing, dehydration signs
COMMON EXAMINATION TERMS: weight centile, height centile, head circumference,
  developmental milestones, immunization status, Moro reflex, 
  tone (hypo/hypertonia), anterior fontanelle (bulging/sunken/normal)`,

    Ophthalmology: `
SPECIALTY: Ophthalmology
COMMON ANATOMY: eye (right/left), cornea, conjunctiva, iris, lens, retina, 
  macula, optic disc, vitreous, lacrimal duct, eyelid, sclera
COMMON FINDINGS: redness, discharge (purulent/watery/mucoid), photophobia, 
  foreign body sensation, blurred vision, floaters, flashes, 
  visual field defect, raised IOP, cataract, glaucoma
COMMON EXAMINATION TERMS: visual acuity (6/6 etc), IOP, slit lamp findings,
  fundoscopy, direct/indirect ophthalmoscopy, Schirmer test, TBUT`,

    ENT: `
SPECIALTY: ENT (Otorhinolaryngology)  
COMMON ANATOMY: ear (external/middle/inner), nose, nasal septum, turbinates,
  sinuses (maxillary/frontal/ethmoid/sphenoid), throat, tonsils, pharynx, 
  larynx, vocal cords, tympanic membrane, mastoid
COMMON FINDINGS: otalgia, otorrhoea, hearing loss, tinnitus, vertigo,
  nasal obstruction, epistaxis, rhinorrhoea, snoring, hoarseness, 
  dysphagia, odynophagia, foreign body
COMMON EXAMINATION TERMS: otoscopy, anterior rhinoscopy, indirect laryngoscopy,
  tuning fork tests (Rinne/Weber), pure tone audiometry, tympanometry`,

    Dermatology: `
SPECIALTY: Dermatology
COMMON ANATOMY: skin (any body site), hair, nails, mucous membranes, scalp
COMMON FINDINGS: rash, itching/pruritus, papule, macule, vesicle, bulla, 
  pustule, nodule, plaque, erythema, hyperpigmentation, hypopigmentation, 
  scaling, crusting, ulcer, erosion, excoriation, lichenification, alopecia
COMMON EXAMINATION TERMS: distribution (localised/generalised), 
  morphology, Koebner phenomenon, Auspitz sign, dermoscopy findings`,

    Surgery: `
SPECIALTY: General Surgery
COMMON ANATOMY: abdomen (all quadrants), inguinal region, hernia sites,
  appendix, gallbladder, stomach, intestines, rectum, anus, breast,
  thyroid, lymph nodes, wound sites
COMMON FINDINGS: lump, mass, tenderness, guarding, rigidity, rebound,
  bowel sounds (present/absent/increased), hernia (reducible/irreducible),
  discharge (wound), bleeding, obstruction symptoms
COMMON EXAMINATION TERMS: Murphy sign, McBurney point, Rovsing sign,
  cough impulse, ring test, transillumination, DRE findings`,

    Cardiology: `
SPECIALTY: Cardiology
COMMON ANATOMY: heart, coronary arteries, aorta, pulmonary artery/vein,
  carotid, jugular vein, pericardium, valves (mitral/aortic/tricuspid/pulmonary)
COMMON FINDINGS: chest pain, palpitation, syncope, dyspnoea, orthopnoea,
  PND, pedal oedema, murmur, irregular pulse, raised JVP, 
  cardiomegaly, heart failure, arrhythmia
COMMON EXAMINATION TERMS: heart sounds (S1/S2/S3/S4), murmur grading (1-6),
  apex beat, heave, thrill, BP (systolic/diastolic), pulse characteristics`,

    Pulmonology: `
SPECIALTY: Pulmonology / Respiratory Medicine
COMMON ANATOMY: lungs (right/left, lobes), bronchi, trachea, pleura, 
  diaphragm, chest wall, mediastinum
COMMON FINDINGS: cough (dry/productive), sputum (amount/color/blood),
  breathlessness (grade I-IV), wheeze, stridor, haemoptysis,
  chest pain (pleuritic), cyanosis, clubbing, barrel chest
COMMON EXAMINATION TERMS: breath sounds, vocal resonance, percussion note,
  tracheal position, expansion (bilateral/unilateral), fremitus,
  SpO2, peak flow, spirometry (FEV1/FVC)`,

    Psychiatry: `
SPECIALTY: Psychiatry
COMMON FINDINGS: low mood, anxiety, sleep disturbance, appetite change,
  suicidal ideation, auditory/visual hallucination, delusion, 
  disorientation, memory impairment, agitation, psychomotor retardation,
  substance use, withdrawal symptoms
COMMON EXAMINATION TERMS: mental status examination (appearance, behavior,
  speech, mood, affect, thought content/form, perception, cognition,
  insight, judgment), MMSE score, PHQ-9, GAD-7, CAGE`,

    Nephrology: `
SPECIALTY: Nephrology
COMMON ANATOMY: kidneys (right/left), ureters, bladder, urethra, 
  renal artery/vein, dialysis access (AV fistula/graft, catheter)
COMMON FINDINGS: oedema (pedal/facial/generalized), oliguria, anuria,
  polyuria, nocturia, haematuria, proteinuria, dysuria, flank pain,
  raised creatinine, electrolyte abnormality
COMMON EXAMINATION TERMS: fluid status, renal angle tenderness, 
  AV fistula thrill/bruit, dialysis adequacy, BP monitoring`,
  };

  const specialtyContext =
    SPECIALTY_CONTEXTS[specialty] || SPECIALTY_CONTEXTS["General Medicine"] || "";

  return `You are a clinical documentation AI for DocPad EHR (India). 
You receive raw speech-to-text transcripts from doctors during OPD consultations.
Your job: extract structured clinical entities from the transcript.

${specialtyContext}

RULES — FOLLOW EXACTLY:
1. ALWAYS return finding and bodySite as SEPARATE fields. NEVER combine them.
2. PRESERVE the exact anatomical site the doctor said. 
   - "right thigh pain" → bodySite: "thigh", laterality: "right", finding: "pain". NOT "inguinal pain"
   - "purulent discharge from right toe" → bodySite: "toe", laterality: "right", finding: "purulent discharge". NOT "conjunctival discharge"
   - "left knee swelling" → bodySite: "knee", laterality: "left", finding: "swelling"
3. Extract laterality (left/right/bilateral) as a SEPARATE field from bodySite.
4. Detect negation: "no crepitations" → negation: true, finding: "crepitations"
5. Extract duration if mentioned: "5 days", "2 weeks", "3 months"
6. Extract severity if mentioned: "mild", "moderate", "severe"
7. For Hindi/Hinglish input, translate to standard English medical terminology:
   - "dard" → "pain", "sujan" → "swelling", "bukhar" → "fever"
   - "khansi" → "cough", "chaati saaf hai" → "chest clear"
   - "haddee" → "bone", "ghutna" → "knee", "kamar" → "back/lumbar"
   - "pair" → "foot/leg", "haath" → "hand", "sar" → "head"
   - "pet" → "abdomen", "gala" → "throat", "aankh" → "eye"
   - "kaan" → "ear", "naak" → "nose", "ungli" → "finger"
   - "angutha" → "thumb/big toe"
8. Context type "${contextType}" determines what to extract:
   - "chief_complaint": symptoms, duration, body site
   - "hpi": history details, onset, progression, aggravating/relieving factors
   - "examination": physical findings, positive AND negative findings
   - "diagnosis": clinical diagnoses
   - "past_history": prior conditions, surgeries, medications
   - "family_history": family conditions
   - "investigation": test orders

RESPOND WITH ONLY valid JSON array. No markdown, no backticks, no explanation.

SCHEMA:
[
  {
    "finding": "string — the clinical term ONLY (no body site here)",
    "bodySite": "string | null — exact anatomical site without laterality", 
    "laterality": "left | right | bilateral | null",
    "negation": false,
    "duration": "string | null — e.g. '5 days', '2 weeks'",
    "severity": "mild | moderate | severe | null",
    "rawText": "string — the original spoken fragment this was extracted from"
  }
]

EXAMPLES:
Input: "patient has pain in right knee for 3 months with swelling and no instability"
Output:
[
  {"finding": "pain", "bodySite": "knee", "laterality": "right", "negation": false, "duration": "3 months", "severity": null, "rawText": "pain in right knee for 3 months"},
  {"finding": "swelling", "bodySite": "knee", "laterality": "right", "negation": false, "duration": null, "severity": null, "rawText": "swelling"},
  {"finding": "instability", "bodySite": "knee", "laterality": "right", "negation": true, "duration": null, "severity": null, "rawText": "no instability"}
]

Input: "purulent discharge from right great toe, wound is infected"
Output:
[
  {"finding": "purulent discharge", "bodySite": "great toe", "laterality": "right", "negation": false, "duration": null, "severity": null, "rawText": "purulent discharge from right great toe"},
  {"finding": "wound infection", "bodySite": "great toe", "laterality": "right", "negation": false, "duration": null, "severity": null, "rawText": "wound is infected"}
]

Input: "right thigh pain, moderate severity, started 1 week ago after fall"
Output:
[
  {"finding": "pain", "bodySite": "thigh", "laterality": "right", "negation": false, "duration": "1 week", "severity": "moderate", "rawText": "right thigh pain moderate severity started 1 week ago after fall"}
]

Input: "chaati saaf hai, wheeze nahi hai, crepitations nahi"
Output:
[
  {"finding": "chest clear", "bodySite": "chest", "laterality": null, "negation": false, "duration": null, "severity": null, "rawText": "chaati saaf hai"},
  {"finding": "wheeze", "bodySite": "chest", "laterality": null, "negation": true, "duration": null, "severity": null, "rawText": "wheeze nahi hai"},
  {"finding": "crepitations", "bodySite": "chest", "laterality": null, "negation": true, "duration": null, "severity": null, "rawText": "crepitations nahi"}
]`;
}

/** Map VoiceDictationButton contextType to prompt context string. */
export function mapVoiceContextToGeminiContext(contextType: string): string {
  switch (contextType) {
    case "complaint":
      return "chief_complaint";
    case "examination":
      return "examination";
    case "advice":
      return "chief_complaint";
    default:
      return contextType;
  }
}
