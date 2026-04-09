/**
 * Client-side validation for invitation sign-up (doctor vs staff).
 * No Zod dependency — mirrors separate schemas for each path.
 */

export type DoctorSignUpFields = {
  fullName: string;
  medicalRegNumber: string;
  qualifications: string;
  specialization: string;
  phone: string;
  password: string;
  confirmPassword: string;
};

export type StaffSignUpFields = {
  fullName: string;
  phone: string;
  experienceNotes: string;
  password: string;
  confirmPassword: string;
};

export function validateAuthPasswords(password: string, confirmPassword: string): string | null {
  if (!password.trim()) return "Please choose a password.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  if (password !== confirmPassword) return "Passwords do not match.";
  return null;
}

export function validateDoctorSignUp(f: DoctorSignUpFields): string | null {
  if (!f.fullName.trim()) return "Please enter your full name.";
  if (!f.medicalRegNumber.trim()) return "Please enter your medical registration number.";
  if (!f.qualifications.trim()) return "Please enter your degrees / qualifications.";
  if (!f.specialization.trim()) return "Please select or enter your specialization.";
  if (!f.phone.trim()) return "Please enter your phone number.";
  return validateAuthPasswords(f.password, f.confirmPassword);
}

export function validateStaffSignUp(f: StaffSignUpFields): string | null {
  if (!f.fullName.trim()) return "Please enter your full name.";
  return validateAuthPasswords(f.password, f.confirmPassword);
}

/** Map DB invitation role to sign-up form variant. */
export function classifyInviteRole(roleRaw: string | null | undefined): "doctor" | "staff" | "unknown" {
  const r = (roleRaw ?? "").trim().toLowerCase();
  if (!r) return "unknown";
  if (r === "doctor" || r === "physician") return "doctor";
  if (r === "nurse" || r === "pharmacist" || r === "receptionist" || r === "admin") return "staff";
  return "unknown";
}

/** Split "First Rest" → first_name, last_name for `practitioners`. */
export function splitFullName(fullName: string): { first_name: string; last_name: string } {
  const t = fullName.trim().replace(/\s+/g, " ");
  if (!t) return { first_name: "", last_name: "" };
  const i = t.indexOf(" ");
  if (i === -1) return { first_name: t, last_name: "" };
  return { first_name: t.slice(0, i), last_name: t.slice(i + 1).trim() };
}
