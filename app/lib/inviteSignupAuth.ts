import type { AuthError } from "@supabase/supabase-js";

/** Supabase Auth returns this when the email already has an account — use sign-in + `complete_invitation_signup` RPC. */
export function isAuthUserAlreadyRegisteredError(
  error: Pick<AuthError, "message" | "status"> | { message?: string; status?: number },
): boolean {
  const m = (error.message ?? "").toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) return true;
  if (m.includes("user already exists")) return true;
  if (error.status === 422 && m.includes("already")) return true;
  return false;
}

export type InviteProfileFields = {
  roleKind: "doctor" | "staff";
  fullName: string;
  doctorMedReg: string;
  doctorQualifications: string;
  doctorSpecialization: string;
  doctorPhone: string;
  staffPhone: string;
  staffNotes: string;
};

/** Maps join form fields to RPC args for `complete_invitation_signup`. */
export function completeInvitationSignupRpcArgs(
  token: string,
  f: InviteProfileFields,
): {
  p_invite_token: string;
  p_full_name: string;
  p_hpr_id: string | null;
  p_qualification: string | null;
  p_specialization: string | null;
  p_phone: string | null;
  p_staff_notes: string | null;
} {
  const fullName = f.fullName.trim();
  if (f.roleKind === "doctor") {
    const d = f.doctorPhone.replace(/\D/g, "");
    const phone = d.length >= 10 ? `+91${d.slice(-10)}` : null;
    return {
      p_invite_token: token,
      p_full_name: fullName,
      p_hpr_id: f.doctorMedReg.trim(),
      p_qualification: f.doctorQualifications.trim(),
      p_specialization: f.doctorSpecialization.trim(),
      p_phone: phone,
      p_staff_notes: null,
    };
  }
  const s = f.staffPhone.replace(/\D/g, "");
  const phone = s.length >= 10 ? `+91${s.slice(-10)}` : null;
  const notes = f.staffNotes.trim();
  return {
    p_invite_token: token,
    p_full_name: fullName,
    p_hpr_id: null,
    p_qualification: null,
    p_specialization: null,
    p_phone: phone,
    p_staff_notes: notes || null,
  };
}
